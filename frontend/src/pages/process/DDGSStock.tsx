import { useEffect, useState, useCallback } from 'react';
import { Package, Plus, Trash2, ChevronDown, ChevronUp, Share2, Eye, X, Clock, Save, Loader2 } from 'lucide-react';
import ProcessPage, { InputCard } from './ProcessPage';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface ProdEntry {
  id: string;
  timeFrom: string;
  timeTo: string;
  operatorName: string;
  bags: number;
  weightPerBag: number;
  totalProduction: number;
  remark: string;
  createdAt: string;
}

interface TodayData {
  shiftDate: string;
  entries: ProdEntry[];
  todayBags: number;
  todayTonnage: number;
  yesterdayBags: number;
  yesterdayTonnage: number;
}

function shiftDate(): string {
  const now = new Date();
  if (now.getHours() < 9) now.setDate(now.getDate() - 1);
  return now.toISOString().split('T')[0];
}

function currentTimeStr(): string {
  return new Date().toTimeString().slice(0, 5);
}

export default function DDGSStock() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';

  // Production entry form
  const [bags, setBags] = useState('');
  const [timeFrom, setTimeFrom] = useState('');
  const [timeTo, setTimeTo] = useState('');
  const [operatorName, setOperatorName] = useState('');
  const [weightPerBag, setWeightPerBag] = useState('50');
  const [remark, setRemark] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Data
  const [todayData, setTodayData] = useState<TodayData | null>(null);
  const [stockDefaults, setStockDefaults] = useState<any>(null);
  const [dispatchSummary, setDispatchSummary] = useState<{ totalNet: number; truckCount: number; totalBags: number }>({ totalNet: 0, truckCount: 0, totalBags: 0 });
  const [showHistory, setShowHistory] = useState(false);
  const [stockEntries, setStockEntries] = useState<any[]>([]);
  const [showPreview, setShowPreview] = useState(false);

  const sd = shiftDate();

  const loadAll = useCallback(async () => {
    try {
      const [todayRes, stockRes, dispRes] = await Promise.all([
        api.get('/ddgs-production/today'),
        api.get('/ddgs-stock/latest'),
        api.get(`/ddgs-dispatch/summary?date=${sd}`),
      ]);
      setTodayData(todayRes.data);
      setStockDefaults(stockRes.data.defaults);
      setDispatchSummary(dispRes.data);

      // Set timeFrom to last entry's timeTo for continuity
      const entries = todayRes.data.entries || [];
      if (entries.length > 0) {
        const lastTo = entries[entries.length - 1].timeTo;
        if (lastTo) setTimeFrom(lastTo);
      }
      setTimeTo(currentTimeStr());
    } catch (e) { console.error(e); }
  }, [sd]);

  useEffect(() => { loadAll(); }, [loadAll]);

  const todayBags = todayData?.todayBags || 0;
  const todayTonnage = todayData?.todayTonnage || 0;
  const yesterdayBags = todayData?.yesterdayBags || 0;
  const yesterdayTonnage = todayData?.yesterdayTonnage || 0;
  const openingStock = stockDefaults?.openingStock || 0;
  const dispatchToday = dispatchSummary?.totalNet || 0;
  const closingStock = openingStock + todayTonnage - dispatchToday;
  const totalProduction = (stockDefaults?.totalProduction || 0) + todayTonnage;
  const totalDispatch = stockDefaults?.cumulativeDispatch || 0;

  async function handleAdd() {
    if (!bags || parseFloat(bags) <= 0) { setMsg({ type: 'err', text: 'Enter bags' }); return; }
    setSaving(true); setMsg(null);
    try {
      await api.post('/ddgs-production', {
        bags, weightPerBag, timeFrom, timeTo, operatorName, remark, shiftDate: sd,
      });
      setMsg({ type: 'ok', text: `Added ${bags} bags (WhatsApp auto-sent)` });
      setBags(''); setRemark('');
      setTimeFrom(timeTo);
      setTimeTo(currentTimeStr());
      loadAll();
    } catch { setMsg({ type: 'err', text: 'Save failed' }); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this entry?')) return;
    await api.delete(`/ddgs-production/${id}`);
    loadAll();
  }

  async function loadStockHistory() {
    const res = await api.get('/ddgs-stock');
    setStockEntries(res.data.entries || []);
  }

  // Save daily stock summary
  async function saveDailyStock() {
    setSaving(true);
    try {
      await api.post('/ddgs-stock', {
        date: sd + 'T00:00:00.000Z',
        yearStart: new Date(sd).getFullYear(),
        openingStock,
        productionToday: todayTonnage,
        dispatchToday,
        closingStock,
        bags: todayBags,
        weightPerBag: 50,
        remarks: `${todayData?.entries?.length || 0} production entries`,
      });
      setMsg({ type: 'ok', text: 'Daily stock saved!' });
      loadAll();
    } catch { setMsg({ type: 'err', text: 'Save failed' }); }
    setSaving(false);
  }

  const entryLines = (todayData?.entries || []).map((e, i) =>
    `${e.timeFrom && e.timeTo ? e.timeFrom + '–' + e.timeTo : 'Entry ' + (i + 1)}${e.operatorName ? ' (' + e.operatorName + ')' : ''}: ${e.bags} bags`
  ).join('\n');

  const previewText = `*DDGS PRODUCTION REPORT*\nDate: ${sd}\n${entryLines ? '\n' + entryLines + '\n' : ''}\n*Today: ${todayBags} bags (${todayTonnage.toFixed(2)} MT)*\nYesterday: ${yesterdayBags} bags (${yesterdayTonnage.toFixed(2)} MT)\n\nOpening: ${openingStock.toFixed(1)} T\n+ Produced: ${todayTonnage.toFixed(2)} T\n- Dispatched: ${dispatchToday.toFixed(2)} T\n*Closing: ${closingStock.toFixed(1)} T*\n\nTotal Production: ${totalProduction.toFixed(1)} T\nTotal Dispatch: ${totalDispatch.toFixed(1)} T`;

  return (
    <ProcessPage title="DDGS Stock" icon={<Package size={28} />}
      description="Track DDGS production bags & inventory"
      flow={{ from: 'Dryer / Production', to: 'DDGS Storage' }} color="bg-amber-600">

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-4 gap-2 md:gap-3 mb-4">
        {[
          { label: 'Today Bags', value: todayBags, unit: 'bags', color: 'bg-green-50 border-green-200', bold: true },
          { label: 'Today Production', value: todayTonnage.toFixed(2), unit: 'MT', color: 'bg-green-50 border-green-200' },
          { label: 'Yesterday', value: `${yesterdayBags}`, unit: `bags (${yesterdayTonnage.toFixed(1)} MT)`, color: 'bg-gray-50 border-gray-200' },
          { label: 'Closing Stock', value: closingStock.toFixed(1), unit: 'MT', color: 'bg-blue-50 border-blue-200', bold: true },
          { label: 'Opening Stock', value: openingStock.toFixed(1), unit: 'MT', color: 'bg-amber-50 border-amber-200' },
          { label: 'Dispatched Today', value: dispatchToday.toFixed(2), unit: 'MT', color: 'bg-red-50 border-red-200' },
          { label: 'Total Production', value: totalProduction.toFixed(1), unit: 'MT', color: 'bg-purple-50 border-purple-200' },
          { label: 'Total Dispatch', value: totalDispatch.toFixed(1), unit: 'MT', color: 'bg-orange-50 border-orange-200' },
        ].map(k => (
          <div key={k.label} className={`rounded-lg border p-2 md:p-3 ${k.color}`}>
            <div className="text-[10px] md:text-xs text-gray-500">{k.label}</div>
            <div className={`text-lg md:text-xl ${k.bold ? 'font-bold' : 'font-semibold'}`}>
              {k.value} <span className="text-[10px] md:text-xs font-normal text-gray-400">{k.unit}</span>
            </div>
          </div>
        ))}
      </div>

      {msg && (
        <div className={`rounded-lg p-3 mb-3 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      {/* Add Bags Form */}
      <InputCard title="Log Bags Produced">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Bags *</label>
            <input type="number" value={bags} onChange={e => setBags(e.target.value)}
              placeholder="e.g. 300" className="input-field text-lg font-bold" autoFocus />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">From Time</label>
            <input type="time" value={timeFrom} onChange={e => setTimeFrom(e.target.value)}
              className="input-field" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">To Time</label>
            <input type="time" value={timeTo} onChange={e => setTimeTo(e.target.value)}
              className="input-field" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Operator Name</label>
            <input type="text" value={operatorName} onChange={e => setOperatorName(e.target.value)}
              placeholder="Name" className="input-field" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-2">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Wt/Bag (kg)</label>
            <input type="number" value={weightPerBag} onChange={e => setWeightPerBag(e.target.value)}
              className="input-field" />
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Remark</label>
            <input type="text" value={remark} onChange={e => setRemark(e.target.value)}
              placeholder="Optional" className="input-field" />
          </div>
        </div>

        <div className="flex items-center gap-3 mt-3">
          <button onClick={handleAdd} disabled={saving}
            className="px-5 py-2 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 flex items-center gap-2 disabled:opacity-50">
            <Plus size={16} /> Add Entry
          </button>
          <span className="text-xs text-gray-400">
            = {((parseFloat(bags) || 0) * (parseFloat(weightPerBag) || 50) / 1000).toFixed(3)} MT
          </span>
        </div>
      </InputCard>

      {/* Today's Entries */}
      {todayData?.entries && todayData.entries.length > 0 && (
        <div className="card mt-4 !p-0 overflow-hidden">
          <div className="bg-green-50 px-4 py-2 border-b flex items-center justify-between">
            <h3 className="text-sm font-semibold text-green-800 flex items-center gap-2">
              <Clock size={14} /> Today's Entries — {sd}
            </h3>
            <span className="text-sm font-bold text-green-700">{todayBags} bags total</span>
          </div>

          {/* Mobile card view */}
          <div className="md:hidden divide-y">
            {todayData.entries.map((e, i) => (
              <div key={e.id} className="px-3 py-2 flex items-center justify-between">
                <div>
                  <span className="font-bold text-sm">{e.bags} bags</span>
                  <span className="text-[10px] text-gray-400 ml-2">
                    {e.timeFrom && e.timeTo ? `${e.timeFrom}–${e.timeTo}` : ''}
                  </span>
                  {e.operatorName && <span className="text-[10px] text-blue-600 ml-2">{e.operatorName}</span>}
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-gray-400">{(e.totalProduction || 0).toFixed(2)} MT</span>
                  {isAdmin && <button onClick={() => handleDelete(e.id)} className="text-red-400"><Trash2 size={12} /></button>}
                </div>
              </div>
            ))}
            <div className="px-3 py-2 bg-green-50 flex items-center justify-between font-bold text-sm">
              <span>Total</span>
              <span>{todayBags} bags ({todayTonnage.toFixed(2)} MT)</span>
            </div>
          </div>

          {/* Desktop table */}
          <table className="w-full text-xs hidden md:table">
            <thead>
              <tr className="bg-gray-50 text-gray-400">
                <th className="text-left px-4 py-2 font-medium">#</th>
                <th className="text-left px-2 py-2 font-medium">Time</th>
                <th className="text-left px-2 py-2 font-medium">Operator</th>
                <th className="text-center px-2 py-2 font-medium">Bags</th>
                <th className="text-center px-2 py-2 font-medium">Wt/Bag</th>
                <th className="text-center px-2 py-2 font-medium">Tonnage</th>
                <th className="text-left px-2 py-2 font-medium">Remark</th>
                <th className="text-right px-4 py-2 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {todayData.entries.map((e, i) => (
                <tr key={e.id} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-2 py-2">{e.timeFrom && e.timeTo ? `${e.timeFrom} – ${e.timeTo}` : '—'}</td>
                  <td className="px-2 py-2">{e.operatorName || '—'}</td>
                  <td className="text-center px-2 py-2 font-bold">{e.bags}</td>
                  <td className="text-center px-2 py-2">{e.weightPerBag} kg</td>
                  <td className="text-center px-2 py-2 text-green-700">{(e.totalProduction || 0).toFixed(3)} MT</td>
                  <td className="px-2 py-2 text-gray-400">{e.remark || ''}</td>
                  <td className="text-right px-4 py-2">
                    {isAdmin && <button onClick={() => handleDelete(e.id)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>}
                  </td>
                </tr>
              ))}
              <tr className="border-t bg-green-50 font-bold">
                <td colSpan={3} className="px-4 py-2">Total</td>
                <td className="text-center px-2 py-2">{todayBags}</td>
                <td></td>
                <td className="text-center px-2 py-2 text-green-700">{todayTonnage.toFixed(3)} MT</td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Preview & Save button */}
      <div className="flex items-center gap-3 mt-4">
        <button onClick={() => setShowPreview(true)}
          className="px-5 py-2.5 bg-amber-600 text-white rounded-lg font-medium text-sm hover:bg-amber-700 flex items-center gap-2">
          <Eye size={16} /> Preview & Save
        </button>
      </div>

      {/* Preview Modal — Share + Save like Liquefaction */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="bg-amber-600 text-white p-4 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold text-lg">DDGS Production Report</h3>
              <button onClick={() => setShowPreview(false)}><X size={20} /></button>
            </div>
            <div className="p-4 space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Shift Date</span><span className="font-medium">{sd}</span></div>

              {/* Today's entries breakdown */}
              {todayData?.entries && todayData.entries.length > 0 && (
                <div className="border-t pt-2">
                  <h4 className="font-semibold text-green-700 mb-1">Today's Entries</h4>
                  <div className="space-y-1">
                    {todayData.entries.map((e, i) => (
                      <div key={e.id} className="flex justify-between text-xs">
                        <span className="text-gray-500">
                          {e.timeFrom && e.timeTo ? `${e.timeFrom}–${e.timeTo}` : `Entry ${i + 1}`}
                          {e.operatorName ? ` (${e.operatorName})` : ''}
                        </span>
                        <b>{e.bags} bags</b>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between text-green-700 font-bold"><span>Today Total</span><b>{todayBags} bags ({todayTonnage.toFixed(2)} MT)</b></div>
                <div className="flex justify-between text-gray-500"><span>Yesterday</span><b>{yesterdayBags} bags ({yesterdayTonnage.toFixed(2)} MT)</b></div>
              </div>

              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between"><span>Opening Stock</span><b>{openingStock.toFixed(1)} T</b></div>
                <div className="flex justify-between text-green-700"><span>+ Production</span><b>{todayTonnage.toFixed(2)} T</b></div>
                <div className="flex justify-between text-red-600"><span>- Dispatch</span><b>{dispatchToday.toFixed(2)} T ({dispatchSummary.truckCount} trucks)</b></div>
                <div className="flex justify-between border-t pt-1 text-lg"><span>Closing Stock</span><b>{closingStock.toFixed(1)} T</b></div>
              </div>
              <div className="border-t pt-2 space-y-1 text-xs text-gray-500">
                <div className="flex justify-between"><span>Total Production (all time)</span><b>{totalProduction.toFixed(1)} T</b></div>
                <div className="flex justify-between"><span>Total Dispatch (all time)</span><b>{totalDispatch.toFixed(1)} T</b></div>
              </div>
            </div>
            <div className="p-4 border-t flex gap-2">
              <button onClick={() => {
                const t = previewText;
                if (navigator.share) { navigator.share({ text: t }).catch(() => { window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(t)}`, '_blank'); }); } else { window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(t)}`, '_blank'); }
              }} className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-green-700">
                <Share2 size={16} /> Share
              </button>
              <button onClick={async () => { await saveDailyStock(); setShowPreview(false); }} disabled={saving}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white py-2.5 rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Save
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stock History */}
      <div className="mt-4">
        <button onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadStockHistory(); }}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-2">
          {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Stock History (Daily)
        </button>
        {showHistory && (
          <div className="card !p-0 overflow-hidden">
            <div className="md:hidden divide-y">
              {stockEntries.map((e: any) => (
                <div key={e.id} className="px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-xs">{new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                    <span className="font-bold text-sm">{e.closingStock?.toFixed(1)} T</span>
                  </div>
                  <div className="flex items-center gap-3 text-[10px] text-gray-500">
                    <span>Open: {e.openingStock?.toFixed(1)}</span>
                    <span className="text-green-700">+{e.productionToday?.toFixed(2)}</span>
                    <span className="text-red-600">-{e.dispatchToday?.toFixed(2)}</span>
                    <span>{e.bags} bags</span>
                  </div>
                </div>
              ))}
              {stockEntries.length === 0 && <div className="text-center py-6 text-gray-400 text-sm">No entries yet</div>}
            </div>
            <table className="w-full text-xs hidden md:table">
              <thead>
                <tr className="bg-gray-50 text-gray-400">
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-center px-2 py-2 font-medium">Opening</th>
                  <th className="text-center px-2 py-2 font-medium">Produced</th>
                  <th className="text-center px-2 py-2 font-medium">Dispatched</th>
                  <th className="text-center px-2 py-2 font-medium">Closing</th>
                  <th className="text-center px-2 py-2 font-medium">Bags</th>
                </tr>
              </thead>
              <tbody>
                {stockEntries.map((e: any) => (
                  <tr key={e.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                    <td className="text-center px-2 py-2">{e.openingStock?.toFixed(1)}</td>
                    <td className="text-center px-2 py-2 text-green-700">{e.productionToday?.toFixed(2)}</td>
                    <td className="text-center px-2 py-2 text-red-600">{e.dispatchToday?.toFixed(2)}</td>
                    <td className="text-center px-2 py-2 font-bold">{e.closingStock?.toFixed(1)}</td>
                    <td className="text-center px-2 py-2">{e.bags}</td>
                  </tr>
                ))}
                {stockEntries.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-6 text-gray-400">No entries yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProcessPage>
  );
}
