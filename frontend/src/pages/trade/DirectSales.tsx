import { useState, useEffect, useCallback } from 'react';
import { Plus, X, Trash2 } from 'lucide-react';
import api from '../../services/api';

interface Customer { id: string; name: string; gstNo?: string; phone?: string; state?: string; address?: string; }

interface Sale {
  id: string; entryNo: number; date: string;
  customerId: string | null; buyerName: string; buyerPhone: string | null; buyerAddress: string | null;
  productName: string; quantity: number; unit: string; rate: number; amount: number;
  vehicleNo: string | null; weightSlipNo: string | null;
  grossWeight: number | null; tareWeight: number | null; netWeight: number | null;
  paymentMode: string; paymentRef: string | null; isPaid: boolean;
  remarks: string | null; createdAt: string;
  customer: { id: string; name: string; gstNo: string | null; phone: string | null; state: string | null } | null;
}

interface Stats { totalEntries: number; todayCount: number; todayAmount: number; totalAmount: number; unpaidCount: number; unpaidAmount: number; }

const PRODUCTS = ['DDGS', 'Spent Wash', 'Scrap Iron', 'Scrap Copper', 'Empty Drums', 'Gunny Bags', 'Coal Ash', 'Other'];
const UNITS = ['KG', 'MT', 'QTL', 'LTR', 'NOS', 'LOT'];
const PAY_MODES = ['CASH', 'UPI', 'BANK_TRANSFER', 'CHEQUE'];

const fmtCurrency = (n: number) => n === 0 ? '--' : '\u20B9' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

const emptyForm = {
  date: new Date().toISOString().split('T')[0],
  customerId: '', buyerName: '', buyerPhone: '', buyerAddress: '',
  productName: 'DDGS', quantity: '', unit: 'KG', rate: '', vehicleNo: '', weightSlipNo: '',
  grossWeight: '', tareWeight: '', netWeight: '',
  paymentMode: 'CASH', paymentRef: '', isPaid: true, remarks: '',
};

export default function DirectSales() {
  const today = new Date().toISOString().split('T')[0];
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().split('T')[0];

  const [from, setFrom] = useState(weekAgo);
  const [to, setTo] = useState(today);
  const [sales, setSales] = useState<Sale[]>([]);
  const [stats, setStats] = useState<Stats>({ totalEntries: 0, todayCount: 0, todayAmount: 0, totalAmount: 0, unpaidCount: 0, unpaidAmount: 0 });
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get(`/direct-sales?from=${from}&to=${to}`);
      setSales(res.data.sales || []);
      setStats(res.data.stats || {});
    } catch { /* */ } finally { setLoading(false); }
  }, [from, to]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    api.get('/customers').then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data?.customers || []);
      setCustomers(list);
    }).catch(() => {});
  }, []);

  function handleFormChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) {
    const { name, value, type } = e.target;
    if (name === 'customerId') {
      const cust = customers.find(c => c.id === value);
      if (cust) {
        setForm(p => ({ ...p, customerId: value, buyerName: cust.name, buyerPhone: cust.phone || '', buyerAddress: [cust.address, cust.state].filter(Boolean).join(', ') }));
      } else {
        setForm(p => ({ ...p, customerId: '', buyerName: '', buyerPhone: '', buyerAddress: '' }));
      }
      return;
    }
    setForm(p => ({ ...p, [name]: type === 'checkbox' ? (e.target as HTMLInputElement).checked : value }));
  }

  async function handleSave() {
    if (!form.buyerName.trim()) { setMsg({ type: 'err', text: 'Buyer name required' }); return; }
    if (!form.quantity || !form.rate) { setMsg({ type: 'err', text: 'Quantity and rate required' }); return; }
    setSaving(true); setMsg(null);
    try {
      await api.post('/direct-sales', form);
      setMsg({ type: 'ok', text: 'Sale recorded' });
      setForm({ ...emptyForm });
      setShowForm(false);
      fetchData();
    } catch (err: any) { setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' }); }
    setSaving(false);
    setTimeout(() => setMsg(null), 3000);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this sale entry?')) return;
    try { await api.delete(`/direct-sales/${id}`); fetchData(); } catch { /* */ }
  }

  const amount = (parseFloat(form.quantity) || 0) * (parseFloat(form.rate) || 0);

  const labelCls = 'text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block';
  const inputCls = 'border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-full';

  if (loading && sales.length === 0) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Scrap & Misc Sales</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Direct Sales Register</span>
          </div>
          <div className="flex items-center gap-2">
            {msg && <span className={`text-[10px] ${msg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</span>}
            <button onClick={() => setShowForm(!showForm)}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1">
              <Plus size={14} /> New Sale
            </button>
          </div>
        </div>

        {/* Quick Entry Form */}
        {showForm && (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
            <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">Quick Entry</span>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>Buyer *</label>
                  <select name="customerId" value={form.customerId} onChange={handleFormChange} className={inputCls}>
                    <option value="">Select from Customer Master</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}{c.gstNo ? ` (${c.gstNo})` : ''}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Buyer Name *</label>
                  <input name="buyerName" value={form.buyerName} onChange={handleFormChange} className={inputCls} placeholder="Auto-filled or manual" />
                </div>
                <div>
                  <label className={labelCls}>Phone</label>
                  <input name="buyerPhone" value={form.buyerPhone} onChange={handleFormChange} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <label className={labelCls}>Product *</label>
                  <select name="productName" value={form.productName} onChange={handleFormChange} className={inputCls}>
                    {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Quantity *</label>
                  <input name="quantity" type="number" step="any" value={form.quantity} onChange={handleFormChange} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Unit</label>
                  <select name="unit" value={form.unit} onChange={handleFormChange} className={inputCls}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Rate</label>
                  <input name="rate" type="number" step="any" value={form.rate} onChange={handleFormChange} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Amount</label>
                  <div className="border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-xs font-mono tabular-nums font-medium">{fmtCurrency(amount)}</div>
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <label className={labelCls}>Vehicle No</label>
                  <input name="vehicleNo" value={form.vehicleNo} onChange={handleFormChange} className={inputCls} placeholder="MH02AB1234" />
                </div>
                <div>
                  <label className={labelCls}>Weight Slip</label>
                  <input name="weightSlipNo" value={form.weightSlipNo} onChange={handleFormChange} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Payment</label>
                  <select name="paymentMode" value={form.paymentMode} onChange={handleFormChange} className={inputCls}>
                    {PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Ref / UTR</label>
                  <input name="paymentRef" value={form.paymentRef} onChange={handleFormChange} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Date</label>
                  <input name="date" type="date" value={form.date} onChange={handleFormChange} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>Remarks</label>
                  <input name="remarks" value={form.remarks} onChange={handleFormChange} className={inputCls} />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <input name="isPaid" type="checkbox" checked={form.isPaid} onChange={handleFormChange} />
                    <span>Paid</span>
                  </label>
                </div>
                <div className="flex items-end">
                  <button onClick={handleSave} disabled={saving}
                    className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 w-full">
                    {saving ? 'Saving...' : 'Save Entry'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Filter Bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex flex-wrap items-end gap-3">
          <div>
            <label className={labelCls}>From</label>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>To</label>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} />
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Today Sales</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.todayCount}</div>
            <div className="text-[10px] text-slate-400">{fmtCurrency(stats.todayAmount)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Amount</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(stats.totalAmount)}</div>
            <div className="text-[10px] text-slate-400">{stats.totalEntries} entries</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Unpaid</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.unpaidCount}</div>
            <div className="text-[10px] text-slate-400">{fmtCurrency(stats.unpaidAmount)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Period Entries</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.totalEntries}</div>
          </div>
        </div>

        {/* Data Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">#</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Buyer</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Product</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Qty</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Unit</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vehicle</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Payment</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest"></th>
              </tr>
            </thead>
            <tbody>
              {sales.length === 0 && (
                <tr><td colSpan={11} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No sales found</td></tr>
              )}
              {sales.map((s, i) => (
                <tr key={s.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 text-slate-400 border-r border-slate-100 font-mono">{s.entryNo}</td>
                  <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 whitespace-nowrap">{fmtDate(s.date)}</td>
                  <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">
                    {s.customer?.name || s.buyerName}
                    {s.customer?.gstNo && <div className="text-[9px] text-slate-400">{s.customer.gstNo}</div>}
                  </td>
                  <td className="px-3 py-1.5 border-r border-slate-100">
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{s.productName}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 border-r border-slate-100">{s.quantity.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-1.5 text-center text-slate-500 border-r border-slate-100">{s.unit}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100">{fmtCurrency(s.rate)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium border-r border-slate-100">{fmtCurrency(s.amount)}</td>
                  <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{s.vehicleNo || '--'}</td>
                  <td className="px-3 py-1.5 text-center border-r border-slate-100">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${s.isPaid ? 'border-green-400 bg-green-50 text-green-700' : 'border-red-400 bg-red-50 text-red-700'}`}>
                      {s.isPaid ? s.paymentMode : 'UNPAID'}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-center">
                    <button onClick={() => handleDelete(s.id)} className="text-red-400 hover:text-red-600"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
            {sales.length > 0 && (
              <tfoot>
                <tr className="bg-slate-800 text-white font-semibold">
                  <td className="px-3 py-2 border-r border-slate-700" colSpan={7}>
                    <span className="text-[10px] uppercase tracking-widest">Total</span>
                  </td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(stats.totalAmount)}</td>
                  <td className="px-3 py-2 border-r border-slate-700" colSpan={3}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
