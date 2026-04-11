import React, { useState, useEffect, useCallback } from 'react';
import { Plus, X, Trash2, Edit2, ChevronDown, ChevronUp } from 'lucide-react';
import api from '../../services/api';

interface Customer { id: string; name: string; gstNo?: string; phone?: string; state?: string; address?: string; }
interface Dispatch {
  id: string; shipmentNo: number; date: string; vehicleNo: string; customerName: string;
  weightTare: number | null; weightGross: number | null; weightNet: number | null; bags: number | null;
  status: string; gateInTime: string | null; grossTime: string | null; releaseTime: string | null;
  productName: string; invoiceRef: string | null;
}
interface Pipeline { atWeighbridge: number; atWeighbridgeVehicles: string; totalDispatches: number; dispatched: number; }

interface Order {
  id: string; entryNo: number; date: string;
  customerId: string | null; buyerName: string; buyerPhone: string | null; buyerAddress: string | null;
  productName: string; rate: number; unit: string;
  validFrom: string; validTo: string | null; status: string;
  quantity: number; totalSuppliedQty: number; totalSuppliedAmt: number;
  remarks: string | null; createdAt: string;
  customer: { id: string; name: string; gstNo: string | null; phone: string | null; state: string | null } | null;
}

interface Stats { total: number; active: number; expiringSoon: number; totalSuppliedAmt: number; }

const PRODUCTS = ['Scrap Iron', 'Scrap Copper', 'Scrap SS', 'Empty Drums', 'Gunny Bags', 'Coal Ash', 'Waste Oil', 'Spent Wash', 'Other'];
const UNITS = ['KG', 'MT', 'QTL', 'LTR', 'NOS', 'LOT'];

const fmtCurrency = (n: number) => n === 0 ? '--' : '\u20B9' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '--';

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'border-green-400 bg-green-50 text-green-700',
  EXPIRED: 'border-red-400 bg-red-50 text-red-700',
  CLOSED: 'border-slate-400 bg-slate-100 text-slate-600',
};

const emptyForm = {
  customerId: '', buyerName: '', buyerPhone: '', buyerAddress: '',
  productName: 'Scrap Iron', rate: '', unit: 'KG', quantity: '',
  validFrom: new Date().toISOString().split('T')[0],
  validTo: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
  remarks: '',
};

export default function DirectSales() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, active: 0, expiringSoon: 0, totalSuppliedAmt: 0 });
  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dispatches, setDispatches] = useState<Dispatch[]>([]);
  const [pipeline, setPipeline] = useState<Pipeline | null>(null);
  const [loadingDispatches, setLoadingDispatches] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (statusFilter !== 'ALL') params.set('status', statusFilter);
      const res = await api.get(`/direct-sales?${params}`);
      setOrders(res.data.orders || []);
      setStats(res.data.stats || {});
    } catch { /* */ } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => {
    api.get('/customers').then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data?.customers || []);
      setCustomers(list);
    }).catch(() => {});
  }, []);

  function handleFormChange(e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) {
    const { name, value } = e.target;
    if (name === 'customerId') {
      const cust = customers.find(c => c.id === value);
      if (cust) {
        setForm(p => ({ ...p, customerId: value, buyerName: cust.name, buyerPhone: cust.phone || '', buyerAddress: [cust.address, cust.state].filter(Boolean).join(', ') }));
      } else {
        setForm(p => ({ ...p, customerId: '', buyerName: '', buyerPhone: '', buyerAddress: '' }));
      }
      return;
    }
    setForm(p => ({ ...p, [name]: value }));
  }

  function openEdit(o: Order) {
    setEditId(o.id);
    setForm({
      customerId: o.customerId || '',
      buyerName: o.buyerName,
      buyerPhone: o.buyerPhone || '',
      buyerAddress: o.buyerAddress || '',
      productName: o.productName,
      rate: String(o.rate),
      unit: o.unit,
      quantity: o.quantity ? String(o.quantity) : '',
      validFrom: o.validFrom?.split('T')[0] || '',
      validTo: o.validTo?.split('T')[0] || '',
      remarks: o.remarks || '',
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.buyerName.trim()) { setMsg({ type: 'err', text: 'Select a buyer' }); return; }
    if (!form.rate) { setMsg({ type: 'err', text: 'Rate is required' }); return; }
    setSaving(true); setMsg(null);
    try {
      if (editId) {
        await api.put(`/direct-sales/${editId}`, form);
        setMsg({ type: 'ok', text: 'Order updated' });
      } else {
        await api.post('/direct-sales', form);
        setMsg({ type: 'ok', text: 'Order created' });
      }
      setForm({ ...emptyForm });
      setShowForm(false);
      setEditId(null);
      fetchData();
    } catch (err: any) { setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' }); }
    setSaving(false);
    setTimeout(() => setMsg(null), 3000);
  }

  async function handleStatusChange(id: string, status: string) {
    try { await api.put(`/direct-sales/${id}`, { status }); fetchData(); } catch { /* */ }
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setLoadingDispatches(true);
    try {
      const res = await api.get(`/direct-sales/${id}/dispatches`);
      setDispatches(res.data.shipments || []);
      setPipeline(res.data.pipeline || null);
    } catch { setDispatches([]); setPipeline(null); }
    setLoadingDispatches(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this order?')) return;
    try { await api.delete(`/direct-sales/${id}`); fetchData(); } catch { /* */ }
  }

  const labelCls = 'text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block';
  const inputCls = 'border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-full';

  if (loading && orders.length === 0) return (
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
            <span className="text-[10px] text-slate-400">Rate Orders & Dispatch Tracking</span>
          </div>
          <div className="flex items-center gap-2">
            {msg && <span className={`text-[10px] ${msg.type === 'ok' ? 'text-green-400' : 'text-red-400'}`}>{msg.text}</span>}
            <button onClick={() => { setEditId(null); setForm({ ...emptyForm }); setShowForm(!showForm); }}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1">
              <Plus size={14} /> New Order
            </button>
          </div>
        </div>

        {/* Order Form */}
        {showForm && (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
            <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">{editId ? 'Edit Order' : 'New Scrap Sales Order'}</span>
              <button onClick={() => { setShowForm(false); setEditId(null); }} className="text-slate-400 hover:text-white"><X size={16} /></button>
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
                  <input name="buyerName" value={form.buyerName} onChange={handleFormChange} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Phone</label>
                  <input name="buyerPhone" value={form.buyerPhone} onChange={handleFormChange} className={inputCls} />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div>
                  <label className={labelCls}>Product *</label>
                  <select name="productName" value={form.productName} onChange={handleFormChange} className={inputCls}>
                    {PRODUCTS.map(p => <option key={p} value={p}>{p}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Rate *</label>
                  <input name="rate" type="number" step="any" value={form.rate} onChange={handleFormChange} className={inputCls} placeholder="Per unit" />
                </div>
                <div>
                  <label className={labelCls}>Unit</label>
                  <select name="unit" value={form.unit} onChange={handleFormChange} className={inputCls}>
                    {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelCls}>Valid From</label>
                  <input name="validFrom" type="date" value={form.validFrom} onChange={handleFormChange} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Valid To</label>
                  <input name="validTo" type="date" value={form.validTo} onChange={handleFormChange} className={inputCls} />
                </div>
                <div>
                  <label className={labelCls}>Est. Qty</label>
                  <input name="quantity" type="number" step="any" value={form.quantity} onChange={handleFormChange} className={inputCls} placeholder="0 = open" />
                </div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="col-span-2">
                  <label className={labelCls}>Remarks</label>
                  <input name="remarks" value={form.remarks} onChange={handleFormChange} className={inputCls} />
                </div>
                <div className="col-span-2 flex items-end">
                  <button onClick={handleSave} disabled={saving}
                    className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                    {saving ? 'Saving...' : editId ? 'Update Order' : 'Create Order'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Status Filter Tabs */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4">
          {['ALL', 'ACTIVE', 'EXPIRED', 'CLOSED'].map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`text-[11px] font-bold uppercase tracking-widest pb-0.5 ${statusFilter === s ? 'text-blue-700 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
              {s}
            </button>
          ))}
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Orders</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.active}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Orders</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.total}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Expiring Soon</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.expiringSoon}</div>
            <div className="text-[10px] text-slate-400">Within 2 days</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-indigo-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Supplied</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(stats.totalSuppliedAmt)}</div>
          </div>
        </div>

        {/* Data Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">#</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Buyer</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Product</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Unit</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Valid From</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Valid To</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplied</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No orders found</td></tr>
              )}
              {orders.map((o, i) => {
                const daysLeft = o.validTo ? Math.ceil((new Date(o.validTo).getTime() - Date.now()) / 86400000) : null;
                return (<React.Fragment key={o.id}>
                  <tr className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''}`} onClick={() => toggleExpand(o.id)}>
                    <td className="px-3 py-1.5 text-slate-400 border-r border-slate-100 font-mono">{o.entryNo}</td>
                    <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">
                      {o.customer?.name || o.buyerName}
                      {o.customer?.gstNo && <div className="text-[9px] text-slate-400">{o.customer.gstNo}</div>}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{o.productName}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium border-r border-slate-100">{fmtCurrency(o.rate)}</td>
                    <td className="px-3 py-1.5 text-center text-slate-500 border-r border-slate-100">{o.unit}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 whitespace-nowrap">{fmtDate(o.validFrom)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">
                      <span className="text-slate-600">{fmtDate(o.validTo)}</span>
                      {daysLeft !== null && daysLeft >= 0 && daysLeft <= 2 && o.status === 'ACTIVE' && (
                        <span className="text-[9px] text-amber-600 font-bold ml-1">{daysLeft}d left</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_COLORS[o.status] || 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                        {o.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                      {o.totalSuppliedQty > 0 ? `${o.totalSuppliedQty.toLocaleString('en-IN')} ${o.unit}` : '--'}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button onClick={() => openEdit(o)} className="text-slate-400 hover:text-blue-600" title="Edit"><Edit2 size={13} /></button>
                        {o.status === 'ACTIVE' && (
                          <button onClick={() => handleStatusChange(o.id, 'CLOSED')} className="text-[9px] text-slate-400 hover:text-red-600 border border-slate-200 px-1" title="Close">CLOSE</button>
                        )}
                        {o.status !== 'ACTIVE' && (
                          <button onClick={() => handleDelete(o.id)} className="text-red-400 hover:text-red-600" title="Delete"><Trash2 size={13} /></button>
                        )}
                        <button onClick={() => toggleExpand(o.id)} className="text-slate-400 hover:text-slate-600">
                          {expandedId === o.id ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </div>
                    </td>
                  </tr>
                  {/* Expanded dispatch panel */}
                  {expandedId === o.id && (
                    <tr>
                      <td colSpan={10} className="bg-slate-50 border-b border-slate-200 p-0">
                        <div className="px-4 py-3">
                          {/* Supply Progress */}
                          {o.quantity > 0 && (
                            <div className="mb-3">
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Supply Progress</span>
                                <span className="text-[11px] font-mono text-slate-600">
                                  {o.totalSuppliedQty.toLocaleString('en-IN')} / {o.quantity.toLocaleString('en-IN')} {o.unit} ({o.quantity > 0 ? Math.round(o.totalSuppliedQty / o.quantity * 100) : 0}%)
                                </span>
                              </div>
                              <div className="w-full bg-slate-200 h-2">
                                <div className="bg-green-500 h-2" style={{ width: `${Math.min(100, o.quantity > 0 ? (o.totalSuppliedQty / o.quantity) * 100 : 0)}%` }} />
                              </div>
                              <div className="text-[10px] text-slate-400 mt-0.5">{Math.max(0, o.quantity - o.totalSuppliedQty).toLocaleString('en-IN')} {o.unit} remaining</div>
                            </div>
                          )}

                          {/* Pipeline KPIs */}
                          {pipeline && (
                            <div className="grid grid-cols-3 gap-0 border border-slate-300 mb-3">
                              <div className={`px-3 py-2 border-r border-slate-300 ${pipeline.atWeighbridge > 0 ? 'bg-orange-50' : 'bg-white'}`}>
                                <div className={`text-[10px] font-bold uppercase tracking-widest ${pipeline.atWeighbridge > 0 ? 'text-orange-600' : 'text-slate-400'}`}>At Weighbridge</div>
                                <div className="text-lg font-bold text-slate-800 font-mono">{pipeline.atWeighbridge}</div>
                                {pipeline.atWeighbridgeVehicles && <div className="text-[9px] text-orange-500 mt-0.5">{pipeline.atWeighbridgeVehicles}</div>}
                              </div>
                              <div className="bg-white px-3 py-2 border-r border-slate-300">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Dispatches</div>
                                <div className="text-lg font-bold text-slate-800 font-mono">{pipeline.totalDispatches}</div>
                              </div>
                              <div className="bg-white px-3 py-2">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Completed</div>
                                <div className="text-lg font-bold text-slate-800 font-mono">{pipeline.dispatched}</div>
                              </div>
                            </div>
                          )}

                          {/* Dispatch table */}
                          {loadingDispatches ? (
                            <div className="text-xs text-slate-400 uppercase tracking-widest py-4 text-center">Loading dispatches...</div>
                          ) : dispatches.length === 0 ? (
                            <div className="text-xs text-slate-400 uppercase tracking-widest py-4 text-center">No dispatches yet</div>
                          ) : (
                            <table className="w-full text-xs border border-slate-300">
                              <thead>
                                <tr className="bg-slate-700 text-white">
                                  <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">Date</th>
                                  <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">Vehicle</th>
                                  <th className="text-right px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">Tare (kg)</th>
                                  <th className="text-right px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">Gross (kg)</th>
                                  <th className="text-right px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">Net (kg)</th>
                                  <th className="text-right px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">Amount</th>
                                  <th className="text-center px-2 py-1.5 text-[9px] uppercase tracking-widest">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dispatches.map((d, di) => {
                                  const netKg = d.weightNet || 0;
                                  const amt = netKg * o.rate; // rate per unit (KG)
                                  return (
                                    <tr key={d.id} className={`border-b border-slate-100 ${di % 2 ? 'bg-slate-50/50' : ''}`}>
                                      <td className="px-2 py-1 text-slate-600 border-r border-slate-100">{fmtDate(d.date)}</td>
                                      <td className="px-2 py-1 text-slate-800 font-medium border-r border-slate-100">{d.vehicleNo}</td>
                                      <td className="px-2 py-1 text-right font-mono text-slate-500 border-r border-slate-100">{d.weightTare?.toLocaleString('en-IN') || '--'}</td>
                                      <td className="px-2 py-1 text-right font-mono text-slate-500 border-r border-slate-100">{d.weightGross?.toLocaleString('en-IN') || '--'}</td>
                                      <td className="px-2 py-1 text-right font-mono text-slate-800 font-medium border-r border-slate-100">{netKg > 0 ? netKg.toLocaleString('en-IN') : '--'}</td>
                                      <td className="px-2 py-1 text-right font-mono text-slate-700 border-r border-slate-100">{netKg > 0 ? fmtCurrency(amt) : '--'}</td>
                                      <td className="px-2 py-1 text-center">
                                        <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border ${
                                          d.status === 'GROSS_WEIGHED' || d.status === 'RELEASED' ? 'border-green-400 bg-green-50 text-green-700' :
                                          d.status === 'LOADING' ? 'border-blue-400 bg-blue-50 text-blue-700' :
                                          'border-amber-400 bg-amber-50 text-amber-700'
                                        }`}>{d.status.replace(/_/g, ' ')}</span>
                                      </td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>);
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
