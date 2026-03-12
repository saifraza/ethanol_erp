import { useState, useEffect } from 'react';
import { Fuel, Save, ChevronDown, ChevronUp, Eye, X, Share2, Loader2, TrendingUp, Droplets, Gauge, Truck, Clock, Activity, Package, Factory } from 'lucide-react';
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

export default function EthanolProduct() {
  const [form, setForm] = useState<any>({});
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [time, setTime] = useState(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
  const [prev, setPrev] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [calData, setCalData] = useState<Record<string, Record<string, number>>>({});
  const [todayDispatch, setTodayDispatch] = useState(0);
  const [dispatchList, setDispatchList] = useState<any[]>([]);
  const [fuelOpen, setFuelOpen] = useState(false);
  const [lastEntry, setLastEntry] = useState<any>(null);
  const [lastPrevDate, setLastPrevDate] = useState<string | null>(null);
  const [lastPrevStock, setLastPrevStock] = useState<number | null>(null);
  const [allTimeDispatched, setAllTimeDispatched] = useState(0);
  const [allTimeDispatchCount, setAllTimeDispatchCount] = useState(0);
  const MASH_GIVEN = 2040000; // historical ethanol given to mash

  useEffect(() => {
    api.get('/calibration').then(r => setCalData(r.data)).catch(e => console.error('Cal load error:', e));
    loadTotals();
  }, []);

  async function loadTotals() {
    try {
      const res = await api.get('/dispatch/totals');
      setAllTimeDispatched(res.data.totalDispatched || 0);
      setAllTimeDispatchCount(res.data.count || 0);
    } catch (e) { console.error(e); }
  }

  // Build proper local datetime from date + time inputs
  const buildEntryDate = (): Date => {
    const [year, month, day] = date.split('-').map(Number);
    const [h, m] = (time || '00:00').split(':').map(Number);
    return new Date(year, month - 1, day, h, m, 0, 0); // local timezone
  };

  // Load standalone dispatches since prev entry (matches backend production calc)
  useEffect(() => {
    const fromDate = prev?.date ? new Date(prev.date).toISOString() : null;
    const entryDt = buildEntryDate().toISOString();
    const url = fromDate
      ? `/dispatch?from=${fromDate}&to=${entryDt}`
      : `/dispatch?date=${date}`;
    api.get(url).then(r => {
      const dispatches = r.data.dispatches || [];
      const total = dispatches.reduce((s: number, d: any) => s + (d.quantityBL || 0), 0);
      setTodayDispatch(total);
      setDispatchList(dispatches);
    }).catch(() => {});
  }, [date, time, prev]);

  // Load NEW dispatches AFTER last saved entry (for dashboard current stock)
  // Add 1ms to fromDate to make it exclusive (gt behavior), avoiding double-count
  // with dispatches already included in the saved entry's totalDispatch
  const [newDispatch, setNewDispatch] = useState(0);
  const [newDispatchList, setNewDispatchList] = useState<any[]>([]);
  useEffect(() => {
    if (!lastEntry?.date) return;
    // +1ms to exclude dispatches at exactly lastEntry.date (already counted in production)
    const fromDate = new Date(new Date(lastEntry.date).getTime() + 1).toISOString();
    api.get(`/dispatch?from=${fromDate}&to=${new Date().toISOString()}`).then(r => {
      const dispatches = r.data.dispatches || [];
      const total = dispatches.reduce((s: number, d: any) => s + (d.quantityBL || 0), 0);
      setNewDispatch(total);
      setNewDispatchList(dispatches);
    }).catch(() => {});
  }, [lastEntry]);

  const calLookup = (tankKey: string, dipCm: number | null): number | null => {
    if (dipCm === null || dipCm === undefined || isNaN(dipCm)) return null;
    const tankCal = calData[tankKey];
    if (!tankCal) return null;
    const key = String(Math.round(dipCm * 10));
    const litres = tankCal[key];
    return litres !== undefined ? litres : null;
  };

  const u = (key: string, val: any) => setForm((f: any) => ({ ...f, [key]: val }));
  const numU = (key: string, raw: string) => u(key, raw === '' ? null : parseFloat(raw));

  const handleDipChange = (tankKey: string, raw: string) => {
    const dipVal = raw === '' ? null : parseFloat(raw);
    setForm((f: any) => {
      const updated = { ...f, [`${tankKey}Dip`]: dipVal, [`${tankKey}Empty`]: false };
      if (dipVal !== null && !isNaN(dipVal)) {
        const litres = calLookup(tankKey, dipVal);
        if (litres !== null) updated[`${tankKey}Volume`] = litres;
      } else {
        updated[`${tankKey}Volume`] = null;
      }
      return updated;
    });
  };

  const toggleEmpty = (tankKey: string) => {
    setForm((f: any) => {
      const isEmpty = !f[`${tankKey}Empty`];
      return { ...f, [`${tankKey}Empty`]: isEmpty, [`${tankKey}Dip`]: isEmpty ? null : f[`${tankKey}Dip`], [`${tankKey}Volume`]: isEmpty ? 0 : null };
    });
  };

  // Calculations
  const totalStock = TANKS.reduce((s, t) => s + (form[`${t.key}Volume`] || 0), 0);
  const wSum = TANKS.reduce((s, t) => s + (form[`${t.key}Volume`] || 0) * (form[`${t.key}Strength`] || 0), 0);
  const avgStrength = totalStock > 0 ? wSum / totalStock : 0;
  const prevStock = prev ? TANKS.reduce((s, t) => s + (prev[`${t.key}Volume`] || 0), 0) : 0;
  const productionBL = totalStock - prevStock + todayDispatch;
  const productionAL = productionBL * avgStrength / 100;
  // KLPD: production per day in kilolitres
  const prevDate = prev?.date ? new Date(prev.date) : null;
  const curDate = buildEntryDate();
  const hoursBetween = prevDate ? (curDate.getTime() - prevDate.getTime()) / (1000 * 60 * 60) : 0;
  const klpd = hoursBetween > 0 ? (productionBL / hoursBetween) * 24 / 1000 : 0;

  useEffect(() => { loadLatest(); loadEntries(); }, []);

  async function loadLatest(beforeId?: string) {
    try {
      const url = beforeId ? `/ethanol-product/latest?beforeId=${beforeId}` : '/ethanol-product/latest';
      const res = await api.get(url);
      setPrev(res.data.previous);
    } catch (e) { console.error(e); }
  }

  async function loadEntries() {
    try {
      const res = await api.get('/ethanol-product');
      setEntries(res.data.entries);
      if (res.data.entries?.length > 0) {
        setLastEntry(res.data.entries[0]);
        setLastPrevDate(res.data.entries[1]?.date || null);
        setLastPrevStock(res.data.entries[1]?.totalStock ?? null);
      }
    } catch (e) { console.error(e); }
  }

  async function handleSave() {
    if (!date) { setMsg({ type: 'err', text: 'Date is required' }); return; }
    setSaving(true); setMsg(null);
    try {
      const payload = { date: buildEntryDate().toISOString(), ...form, remarks, trucks: [] };
      if (editId) await api.put(`/ethanol-product/${editId}`, payload);
      else await api.post('/ethanol-product', payload);
      const now = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      setMsg({ type: 'ok', text: `Saved at ${now}` });
      setForm({}); setRemarks(''); setEditId(null);
      await loadLatest(); await loadEntries(); await loadTotals();
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
    setDate(e.date.split('T')[0]);
    // Parse time from stored date
    const d = new Date(e.date);
    setTime(d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }));
    // Load prev entry BEFORE this one for correct production calc
    loadLatest(e.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  const fmtDt = (d: string) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '';
  const fmtDtTime = (d: string) => {
    if (!d) return '';
    const dt = new Date(d);
    const date = dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
    const time = dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
    return `${date} ${time}`;
  };

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
          <h1 className="text-xl font-bold text-gray-900">Ethanol Stock</h1>
          <p className="text-xs text-gray-500">Daily tank readings & production calculation (9:00 – 11:30 AM)</p>
        </div>
      </div>

      {/* Dashboard Summary */}
      {lastEntry && (
        <div className="bg-gradient-to-r from-purple-50 to-blue-50 border border-purple-200 rounded-xl p-4 mb-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-purple-600 uppercase">Last — {fmtDtTime(lastEntry.date)}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div className="bg-white/80 rounded-lg p-2.5 text-center">
              <Droplets size={16} className="mx-auto text-gray-400 mb-1" />
              <div className="text-lg font-bold text-gray-600">{lastPrevStock?.toFixed(0) ?? '—'}</div>
              <div className="text-[10px] text-gray-400">Prev Stock</div>
              {lastPrevDate && <div className="text-[9px] text-gray-400">{fmtDtTime(lastPrevDate)}</div>}
            </div>
            <div className="bg-white/80 rounded-lg p-2.5 text-center">
              <Gauge size={16} className="mx-auto text-purple-500 mb-1" />
              <div className="text-lg font-bold text-purple-700">{lastEntry.avgStrength?.toFixed(1) ?? '—'}%</div>
              <div className="text-[10px] text-gray-400">Strength</div>
            </div>
            <div className="bg-white/80 rounded-lg p-2.5 text-center">
              <TrendingUp size={16} className="mx-auto text-green-500 mb-1" />
              <div className="text-lg font-bold text-green-700">{lastEntry.productionBL?.toFixed(0) ?? '—'}</div>
              <div className="text-[10px] text-gray-400">Prod BL</div>
              {lastPrevDate && <div className="text-[9px] text-gray-400">{fmtDtTime(lastPrevDate)} → {fmtDtTime(lastEntry.date)}</div>}
            </div>
            <div className="bg-white/80 rounded-lg p-2.5 text-center">
              <Activity size={16} className="mx-auto text-indigo-500 mb-1" />
              <div className="text-lg font-bold text-indigo-700">{lastEntry.klpd?.toFixed(1) ?? '—'}</div>
              <div className="text-[10px] text-gray-400">KLPD</div>
            </div>
            <div className="bg-white/80 rounded-lg p-2.5 text-center">
              <Truck size={16} className="mx-auto text-red-500 mb-1" />
              <div className="text-lg font-bold text-red-600">{lastEntry.totalDispatch?.toFixed(0) ?? '0'}</div>
              <div className="text-[10px] text-gray-400">Dispatch (in Prod)</div>
            </div>
          </div>
          {/* Current stock = last reading minus any new dispatches since */}
          <div className="mt-2 bg-white/60 rounded-lg p-2 text-center border border-blue-100">
            <div className="text-[10px] text-gray-400 uppercase">Current Stock{newDispatch > 0 ? ' (after dispatch)' : ''}</div>
            <div className="text-xl font-bold text-blue-800">{((lastEntry.totalStock || 0) - newDispatch).toFixed(0)} BL</div>
            {newDispatch > 0 && <div className="text-[10px] text-gray-400">Stock at reading: {lastEntry.totalStock?.toFixed(0)} − {newDispatch.toFixed(0)} dispatched since</div>}
          </div>
          {/* All-time Totals: Dispatched & Produced */}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <div className="bg-white/60 rounded-lg p-2 text-center border border-red-100">
              <Package size={16} className="mx-auto text-red-500 mb-1" />
              <div className="text-[10px] text-gray-400 uppercase">Total Dispatched</div>
              <div className="text-lg font-bold text-red-700">{(allTimeDispatched / 100000).toFixed(2)} L</div>
              <div className="text-[9px] text-gray-400">{allTimeDispatchCount} trucks</div>
            </div>
            <div className="bg-white/60 rounded-lg p-2 text-center border border-green-100">
              <Factory size={16} className="mx-auto text-green-600 mb-1" />
              <div className="text-[10px] text-gray-400 uppercase">Total Produced</div>
              <div className="text-lg font-bold text-green-700">{(((lastEntry?.totalStock || 0) - newDispatch + allTimeDispatched + MASH_GIVEN) / 100000).toFixed(2)} L</div>
              <div className="text-[9px] text-gray-400">Stock + Dispatched + {(MASH_GIVEN/100000).toFixed(1)}L mash</div>
            </div>
          </div>

          {/* New dispatches since last entry */}
          {newDispatchList.length > 0 && (
            <div className="mt-2 space-y-1">
              <div className="text-[10px] text-gray-400 uppercase px-1">Dispatched since last reading</div>
              {newDispatchList.map((d: any, i: number) => (
                <div key={d.id} className="flex items-center justify-between text-xs bg-white/60 rounded px-2 py-1">
                  <span className="text-gray-600">
                    <span className="font-medium text-gray-800">{d.vehicleNo || `Truck ${i+1}`}</span>
                    {d.partyName && <span className="ml-1 text-gray-400">• {d.partyName}</span>}
                    {d.destination && <span className="ml-1 text-gray-400">→ {d.destination}</span>}
                  </span>
                  <span className="font-semibold text-red-600">{d.quantityBL?.toFixed(0)} BL</span>
                </div>
              ))}
            </div>
          )}
          {/* Share dashboard status */}
          <button onClick={() => {
            const curStock = (lastEntry.totalStock || 0) - newDispatch;
            const dispInfo = lastEntry.totalDispatch > 0 ? `\nDispatch (in prod): ${lastEntry.totalDispatch?.toFixed(0)} BL` : '';
            const newDispInfo = newDispatch > 0 ? `\nNew Dispatch: ${newDispatch.toFixed(0)} BL (${newDispatchList.length} trucks)` : '';
            const newTruckLines = newDispatchList.length > 0 ? '\n' + newDispatchList.map((d: any) => `  ${d.vehicleNo} → ${d.destination || '-'} | ${d.quantityBL?.toFixed(0)} BL | ${d.partyName}`).join('\n') : '';
            const prevLine = lastPrevStock != null && lastPrevDate ? `\nPrev Stock: ${lastPrevStock.toFixed(0)} BL (${fmtDtTime(lastPrevDate)})` : '';
            const totalProduced = curStock + allTimeDispatched + MASH_GIVEN;
            const text = `*Ethanol Stock Status*\n📅 ${fmtDtTime(lastEntry.date)}\n${prevLine}\nStock: ${lastEntry.totalStock?.toFixed(0)} BL\nStrength: ${lastEntry.avgStrength?.toFixed(1)}%\nProd: ${lastEntry.productionBL?.toFixed(0)} BL${lastPrevDate ? ` (${fmtDtTime(lastPrevDate)} → ${fmtDtTime(lastEntry.date)})` : ''}\nKLPD: ${lastEntry.klpd?.toFixed(1)}${dispInfo}${newDispInfo}${newTruckLines}\n\n📦 *Current Stock: ${curStock.toFixed(0)} BL*\n🚛 Total Dispatched: ${(allTimeDispatched/100000).toFixed(2)} L BL (${allTimeDispatchCount} trucks)\n🏭 Total Produced: ${(totalProduced/100000).toFixed(2)} L BL`;
            if (navigator.share) {
              navigator.share({ text }).catch(() => {
                window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
              });
            } else {
              window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
            }
          }} className="mt-3 w-full flex items-center justify-center gap-2 bg-green-600 text-white py-2 rounded-lg text-sm font-medium hover:bg-green-700">
            <Share2 size={16} /> Share Status
          </button>
        </div>
      )}

      {/* Date & Time */}
      <div className="mb-5 flex gap-3">
        <div className="flex-1 sm:flex-initial sm:w-48">
          <label className="block text-xs font-medium text-gray-600 mb-1">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border rounded-lg px-3 py-2.5 w-full text-sm" />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Time</label>
          <div className="flex gap-1 items-center">
            <input type="time" value={time} onChange={e => setTime(e.target.value)}
              className="border rounded-lg px-3 py-2.5 w-28 text-sm" />
            <button type="button" onClick={() => { setDate(new Date().toISOString().split('T')[0]); setTime(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })); }}
              className="px-2 py-2.5 bg-blue-500 text-white text-xs rounded-lg whitespace-nowrap font-medium hover:bg-blue-600">Now</button>
          </div>
        </div>
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
                    <label className="flex items-center gap-1 cursor-pointer">
                      <input type="checkbox" checked={!!form[`${tank.key}Empty`]}
                        onChange={() => toggleEmpty(tank.key)}
                        className="rounded border-gray-300" />
                      <span className="text-[10px] text-gray-400">Empty</span>
                    </label>
                  </div>
                  {form[`${tank.key}Empty`] ? (
                    <div className="text-center py-3 text-sm text-gray-400 italic">Tank empty — 0 BL</div>
                  ) : (
                  <div className="grid grid-cols-2 gap-2 mb-2">
                    <div>
                      <label className="text-[10px] text-gray-400">DIP (cm)</label>
                      <input type="number" step="0.1" value={form[`${tank.key}Dip`] ?? ''}
                        onChange={e => handleDipChange(tank.key, e.target.value)}
                        className="border rounded px-2 py-1.5 w-full text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400">Volume (Litres)</label>
                      <input type="number" step="any" value={form[`${tank.key}Volume`] ?? ''}
                        readOnly
                        className="border rounded px-2 py-1.5 w-full text-sm bg-gray-50 font-medium text-blue-700" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400">Strength %</label>
                      <input type="number" step="any" value={form[`${tank.key}Strength`] ?? ''}
                        onChange={e => numU(`${tank.key}Strength`, e.target.value)}
                        className="border rounded px-2 py-1.5 w-full text-sm" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-400">LT %</label>
                      <input type="number" step="any" value={form[`${tank.key}Lt`] ?? ''}
                        onChange={e => numU(`${tank.key}Lt`, e.target.value)}
                        className="border rounded px-2 py-1.5 w-full text-sm" />
                    </div>
                  </div>
                  )}
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
            <div className="text-[10px] text-gray-400 uppercase">Today's Dispatch</div>
            <div className="text-lg font-bold text-red-600">{todayDispatch.toFixed(1)}</div>
          </div>
        </div>
        <div className="border-t mt-3 pt-3 grid grid-cols-2 gap-3 text-center">
          <div>
            <div className="text-[10px] text-gray-400 uppercase">Production BL</div>
            <div className="text-xl font-bold text-green-700">{productionBL.toFixed(2)}</div>
            {prev?.date && <div className="text-[9px] text-gray-400">{fmtDtTime(prev.date)} → {date} {time}</div>}
          </div>
          <div>
            <div className="text-[10px] text-gray-400 uppercase">Flow Rate (KLPD)</div>
            <div className="text-xl font-bold text-indigo-700">{klpd.toFixed(2)}</div>
            {hoursBetween > 0 && <div className="text-[10px] text-gray-400">{hoursBetween.toFixed(1)} hrs</div>}
          </div>
        </div>
      </div>

      {/* RS / HFO / LFO — collapsible, minimized by default */}
      <div className="mb-5">
        <button onClick={() => setFuelOpen(!fuelOpen)}
          className="flex items-center justify-between w-full text-sm font-semibold text-gray-600 uppercase tracking-wide mb-2 hover:text-gray-800">
          <span>RS / HFO / LFO Tanks (15 M3 each)</span>
          {fuelOpen ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
        {fuelOpen && <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
        </div>}
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
            <button onClick={() => { setEditId(null); setForm({}); setRemarks(''); loadLatest(); }}
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
              <h3 className="font-bold text-lg">Ethanol Stock Report</h3>
              <button onClick={() => setShowPreview(false)}><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Date & Time</span><span className="font-medium">{date} {time}</span></div>
              <div className="border-t pt-2">
                <h4 className="font-semibold text-purple-700 mb-1">Tank Readings</h4>
                {TANKS.map(t => {
                  const vol = form[`${t.key}Volume`] || 0;
                  const str = form[`${t.key}Strength`] || 0;
                  const dip = form[`${t.key}Dip`];
                  const empty = form[`${t.key}Empty`];
                  return (
                    <div key={t.key} className="flex justify-between text-xs py-0.5">
                      <span>{t.label}</span>
                      <span className="font-medium">{empty ? 'Empty' : `DIP ${dip ?? '-'} → ${vol.toFixed(0)} L @ ${str.toFixed(1)}%`}</span>
                    </div>
                  );
                })}
              </div>
              <div className="border-t pt-2">
                <h4 className="font-semibold text-purple-700 mb-1">Stock Summary</h4>
                <div className="grid grid-cols-2 gap-1">
                  <div>Prev Stock: <b>{prevStock.toFixed(1)} BL</b></div>
                  <div>Current Stock: <b>{totalStock.toFixed(1)} BL</b></div>
                  <div>Avg Strength: <b>{avgStrength.toFixed(2)}%</b></div>
                  <div>Today Dispatch: <b>{todayDispatch.toFixed(1)} BL</b></div>
                </div>
              </div>
              <div className="border-t pt-2">
                <h4 className="font-semibold text-green-700 mb-1">Production</h4>
                <div>Production BL: <b>{productionBL.toFixed(2)}</b></div>
                <div>Flow: <b>{klpd.toFixed(2)} KLPD</b>{hoursBetween > 0 && <span className="text-gray-400 ml-1">({hoursBetween.toFixed(1)} hrs)</span>}</div>
              </div>
              {remarks && <div className="border-t pt-2"><span className="text-gray-500">Remarks:</span> {remarks}</div>}
            </div>
            <div className="p-4 border-t flex gap-2">
              <button onClick={() => {
                const tankLines = TANKS.map(t => {
                  if (form[`${t.key}Empty`]) return `${t.label}: Empty`;
                  return `${t.label}: ${(form[`${t.key}Volume`] || 0).toFixed(0)}L @ ${(form[`${t.key}Strength`] || 0).toFixed(1)}%`;
                }).join('\n');
                const dispLines = dispatchList.length > 0 ? '\n\n*Dispatch:*\n' + dispatchList.map((d: any) => `${d.vehicleNo} → ${d.destination || '-'} | ${d.quantityBL?.toFixed(0)} BL${d.strength ? ` @ ${d.strength}%` : ''} | ${d.partyName}`).join('\n') : '';
                const text = `*Ethanol Stock Report*\n📅 ${date} ${time}\n\n${tankLines}\n\nStock: ${totalStock.toFixed(1)} BL (${avgStrength.toFixed(2)}%)\nDispatch: ${todayDispatch.toFixed(1)} BL\nProd BL: ${productionBL.toFixed(2)}\nFlow: ${klpd.toFixed(2)} KLPD${dispLines}${remarks ? '\n\nRemarks: ' + remarks : ''}`;
                if (navigator.share) {
                  navigator.share({ text }).catch(() => {
                    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
                  });
                } else {
                  window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
                }
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
                  <div className="text-sm font-medium">{fmtDtTime(e.date)}</div>
                  <div className="text-xs text-gray-500">
                    Stock: {e.totalStock?.toFixed(1)} BL | Prod: {e.productionBL?.toFixed(1)} BL | {e.klpd?.toFixed(1) ?? '—'} KLPD
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
