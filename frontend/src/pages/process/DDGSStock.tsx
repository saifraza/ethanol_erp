import { useEffect, useState } from 'react';
import { Package, Save, Loader2, ChevronDown, ChevronUp, Trash2, Share2, Eye, X } from 'lucide-react';
import ProcessPage, { InputCard, Field } from './ProcessPage';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

interface StockForm {
  date: string;
  bags: number | null;
  weightPerBag: number | null;
  remarks: string;
}

function shiftDate() {
  const now = new Date();
  if (now.getHours() < 9) now.setDate(now.getDate() - 1);
  return now.toISOString().split('T')[0];
}

const emptyForm: StockForm = { date: shiftDate(), bags: null, weightPerBag: 50, remarks: '' };

export default function DDGSStock() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [form, setForm] = useState<StockForm>({ ...emptyForm });
  const [defaults, setDefaults] = useState<any>({ openingStock: 1956.01, cumulativeProduction: 0, cumulativeDispatch: 0, ddgsBaseProduction: 3160, totalProduction: 3160 });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [entries, setEntries] = useState<any[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [dispatchSummary, setDispatchSummary] = useState<{ totalNet: number; truckCount: number; totalBags: number }>({ totalNet: 0, truckCount: 0, totalBags: 0 });
  const [showPreview, setShowPreview] = useState(false);

  const u = (n: string, v: any) => setForm(f => ({ ...f, [n]: v }));

  const productionToday = ((form.bags || 0) * (form.weightPerBag || 50)) / 1000; // convert kg to tonnes
  const openingStock = defaults?.openingStock ?? 1956.01;
  const dispatchToday = dispatchSummary?.totalNet ?? 0;
  const closingStock = (openingStock || 0) + (productionToday || 0) - (dispatchToday || 0);

  useEffect(() => { loadLatest(); loadEntries(); }, []);
  useEffect(() => { loadDispatchSummary(); }, [form.date]);

  async function loadLatest() {
    try {
      const res = await api.get('/ddgs-stock/latest');
      setDefaults(res.data.defaults || { openingStock: 1956.01, cumulativeProduction: 0, cumulativeDispatch: 0, ddgsBaseProduction: 3160, totalProduction: 3160 });
    } catch (e) { console.error(e); }
  }

  async function loadDispatchSummary() {
    try {
      const res = await api.get(`/ddgs-dispatch/summary?date=${form.date}`);
      setDispatchSummary(res.data);
    } catch (e) { console.error(e); }
  }

  async function loadEntries() {
    try {
      const res = await api.get('/ddgs-stock');
      setEntries(res.data.entries || []);
    } catch (e) { console.error(e); }
  }

  async function handleSave() {
    if (!form.date) { setMsg({ type: 'err', text: 'Date required' }); return; }
    setSaving(true); setMsg(null);
    try {
      await api.post('/ddgs-stock', {
        date: form.date + 'T00:00:00.000Z',
        yearStart: new Date(form.date).getFullYear(),
        openingStock,
        productionToday,
        dispatchToday,
        closingStock,
        bags: form.bags || 0,
        weightPerBag: form.weightPerBag || 50,
        remarks: form.remarks,
      });
      setMsg({ type: 'ok', text: 'Saved!' });
      loadLatest(); loadEntries();
      setForm({ ...emptyForm });
      setEditId(null);
    } catch { setMsg({ type: 'err', text: 'Save failed' }); }
    setSaving(false);
  }

  function editEntry(e: any) {
    setEditId(e.id);
    setForm({
      date: new Date(e.date).toISOString().split('T')[0],
      bags: e.bags,
      weightPerBag: e.weightPerBag,
      remarks: e.remarks || '',
    });
    setDefaults((d: any) => ({ ...d, openingStock: e.openingStock }));
  }

  async function deleteEntry(id: string) {
    if (!confirm('Delete this entry?')) return;
    await api.delete(`/ddgs-stock/${id}`);
    loadEntries(); loadLatest();
  }

  const previewText = `*DDGS Stock Update*\n📅 ${form.date}\n\nOpening: ${(openingStock || 0).toFixed(1)} T\nProduction: ${(productionToday || 0).toFixed(2)} T (${form.bags || 0} bags)\nDispatched: ${(dispatchToday || 0).toFixed(2)} T (${dispatchSummary?.truckCount || 0} trucks)\nClosing: ${(closingStock || 0).toFixed(1)} T${form.remarks ? '\n\nRemarks: ' + form.remarks : ''}`;

  return (
    <ProcessPage title="DDGS Stock" icon={<Package size={28} />}
      description="Track DDGS inventory — production in, dispatch out"
      flow={{ from: 'Dryer / Production', to: 'DDGS Storage' }} color="bg-amber-600">

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2 md:gap-3 mb-4 md:mb-5">
        {[
          { label: 'Opening Stock', value: (openingStock || 0).toFixed(1), unit: 'Ton', color: 'bg-amber-50 border-amber-200' },
          { label: 'Produced Today', value: (productionToday || 0).toFixed(2), unit: 'Ton', color: 'bg-green-50 border-green-200' },
          { label: 'Dispatched Today', value: (dispatchToday || 0).toFixed(2), unit: 'Ton', color: 'bg-red-50 border-red-200' },
          { label: 'Closing Stock', value: (closingStock || 0).toFixed(1), unit: 'Ton', color: 'bg-blue-50 border-blue-200' },
          { label: 'Total Produced', value: ((defaults?.totalProduction || 3160) + (productionToday || 0)).toFixed(1), unit: 'Ton', color: 'bg-purple-50 border-purple-200' },
          { label: 'Total Dispatch', value: (defaults?.cumulativeDispatch || 0).toFixed(1), unit: 'Ton', color: 'bg-orange-50 border-orange-200' },
        ].map(k => (
          <div key={k.label} className={`rounded-lg border p-2 md:p-3 ${k.color}`}>
            <div className="text-[10px] md:text-xs text-gray-500">{k.label}</div>
            <div className="text-lg md:text-xl font-bold">{k.value} <span className="text-[10px] md:text-xs font-normal text-gray-400">{k.unit}</span></div>
          </div>
        ))}
      </div>

      {msg && (
        <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{msg.text}</div>
      )}

      {/* Entry Form */}
      <InputCard title={editId ? '✏️ Edit — DDGS Stock' : 'DDGS Production Input'}>
        <Field label="Date" name="date" value={form.date} onChange={(_n: string, v: any) => u('date', v)} />

        <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 mb-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-amber-600 font-medium">Dispatch summary (from DDGS Dispatch page)</span>
            <button onClick={loadDispatchSummary} className="text-xs text-blue-600 hover:underline">Refresh</button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-[10px] text-gray-500">Trucks</div>
              <div className="font-bold text-lg">{dispatchSummary.truckCount}</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500">Dispatched</div>
              <div className="font-bold text-lg text-red-600">{dispatchToday.toFixed(2)} T</div>
            </div>
            <div>
              <div className="text-[10px] text-gray-500">Bags Out</div>
              <div className="font-bold text-lg">{dispatchSummary.totalBags}</div>
            </div>
          </div>
        </div>

        <Field label="Bags Produced" name="bags" value={form.bags} onChange={(_n: string, v: any) => u('bags', v)} placeholder="Number of bags" />
        <Field label="Weight / Bag (kg)" name="weightPerBag" value={form.weightPerBag} onChange={(_n: string, v: any) => u('weightPerBag', v)} />
        <Field label="Production Today" name="productionToday" value={productionToday} auto unit="Ton" />
        <Field label="Opening Stock" name="openingStock" value={openingStock} auto unit="Ton" />
        <Field label="Closing Stock" name="closingStock" value={closingStock} auto unit="Ton" />
        <Field label="Remarks" name="remarks" value={form.remarks} onChange={(_n: string, v: any) => u('remarks', v)} type="text" placeholder="Optional" />

        <div className="flex items-center gap-3 pt-2">
          <button onClick={() => setShowPreview(true)}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg font-medium text-sm hover:bg-amber-700 flex items-center gap-2">
            <Eye size={16} /> Preview
          </button>
          <button onClick={handleSave} disabled={saving}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg font-medium text-sm hover:bg-indigo-700 flex items-center gap-2 disabled:opacity-50">
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} {editId ? 'Update' : 'Save'}
          </button>
        </div>
      </InputCard>

      {/* Preview Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full" onClick={e => e.stopPropagation()}>
            <div className="bg-amber-600 text-white p-3 rounded-t-xl flex items-center justify-between">
              <h3 className="font-bold text-sm">DDGS Stock Report</h3>
              <button onClick={() => setShowPreview(false)}><X size={18} /></button>
            </div>
            <div className="p-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">Date</span><span className="font-medium">{form.date}</span></div>
              <div className="border-t pt-2 space-y-1">
                <div className="flex justify-between"><span>Opening Stock</span><b>{openingStock.toFixed(1)} T</b></div>
                <div className="flex justify-between text-green-700"><span>+ Production</span><b>{productionToday.toFixed(2)} T ({form.bags || 0} bags)</b></div>
                <div className="flex justify-between text-red-600"><span>- Dispatch</span><b>{dispatchToday.toFixed(2)} T ({dispatchSummary.truckCount} trucks)</b></div>
                <div className="flex justify-between border-t pt-1 text-lg"><span>Closing Stock</span><b>{closingStock.toFixed(1)} T</b></div>
              </div>
            </div>
            <div className="p-3 border-t flex gap-2">
              <button onClick={() => {
                if (navigator.share) navigator.share({ text: previewText }).catch(() => {});
                else window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(previewText)}`, '_blank');
              }} className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-2 rounded-lg text-sm font-medium">
                <Share2 size={14} /> Share
              </button>
              <button onClick={() => setShowPreview(false)}
                className="flex-1 flex items-center justify-center gap-2 bg-gray-200 text-gray-700 py-2 rounded-lg text-sm font-medium">
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* History */}
      <div className="mt-4">
        <button onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-2">
          {showHistory ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          Stock History
        </button>
        {showHistory && (
          <div className="card !p-0 overflow-hidden">
            {/* Mobile: card view */}
            <div className="md:hidden divide-y">
              {entries.map((e: any) => (
                <div key={e.id} className="px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-medium text-xs">{new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</span>
                    <span className="font-bold text-sm">{e.closingStock?.toFixed(1)} T</span>
                  </div>
                  <div className="flex items-center justify-between text-[10px] text-gray-500">
                    <div className="flex gap-3">
                      <span>Open: {e.openingStock?.toFixed(1)}</span>
                      <span className="text-green-700">+{e.productionToday?.toFixed(2)}</span>
                      <span className="text-red-600">-{e.dispatchToday?.toFixed(2)}</span>
                      <span>{e.bags} bags</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => editEntry(e)} className="text-blue-500 text-[10px]">Edit</button>
                      {isAdmin && <button onClick={() => deleteEntry(e.id)} className="text-red-400"><Trash2 size={11} /></button>}
                    </div>
                  </div>
                </div>
              ))}
              {entries.length === 0 && (
                <div className="text-center py-6 text-gray-400 text-sm">No stock entries yet</div>
              )}
            </div>
            {/* Desktop: table view */}
            <table className="w-full text-xs hidden md:table">
              <thead>
                <tr className="bg-gray-50 text-gray-400">
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-center px-2 py-2 font-medium">Opening</th>
                  <th className="text-center px-2 py-2 font-medium">Produced</th>
                  <th className="text-center px-2 py-2 font-medium">Dispatched</th>
                  <th className="text-center px-2 py-2 font-medium">Closing</th>
                  <th className="text-center px-2 py-2 font-medium">Bags</th>
                  <th className="text-right px-4 py-2 font-medium"></th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e: any) => (
                  <tr key={e.id} className="border-t hover:bg-gray-50">
                    <td className="px-4 py-2 font-medium">{new Date(e.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                    <td className="text-center px-2 py-2">{e.openingStock?.toFixed(1)}</td>
                    <td className="text-center px-2 py-2 text-green-700">{e.productionToday?.toFixed(2)}</td>
                    <td className="text-center px-2 py-2 text-red-600">{e.dispatchToday?.toFixed(2)}</td>
                    <td className="text-center px-2 py-2 font-bold">{e.closingStock?.toFixed(1)}</td>
                    <td className="text-center px-2 py-2">{e.bags}</td>
                    <td className="text-right px-4 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => editEntry(e)} className="text-blue-500 hover:text-blue-700 text-[10px]">Edit</button>
                        {isAdmin && <button onClick={() => deleteEntry(e.id)} className="text-red-400 hover:text-red-600"><Trash2 size={12} /></button>}
                      </div>
                    </td>
                  </tr>
                ))}
                {entries.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-6 text-gray-400">No stock entries yet</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProcessPage>
  );
}
