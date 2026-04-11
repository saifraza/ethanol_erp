import React, { useState, useEffect, useCallback } from 'react';
import { Plus, X, Trash2, Edit2, ChevronDown, ChevronUp, FileText, Upload } from 'lucide-react';
import api from '../../services/api';

interface Customer { id: string; name: string; gstNo?: string; phone?: string; state?: string; address?: string; }

interface DispatchInvoice {
  id: string; invoiceNo: number; amount: number; totalAmount: number;
  gstPercent: number; gstAmount: number; supplyType: string;
  cgstAmount: number; sgstAmount: number; igstAmount: number;
  rate: number; quantity: number; unit: string; productName: string;
  irn: string | null; irnStatus: string | null; irnDate: string | null; ackNo: string | null;
  ewbNo: string | null; ewbDate: string | null; ewbStatus: string | null;
  status: string; paidAmount: number; balanceAmount: number; freightCharge: number;
  remarks: string | null;
}

interface DispatchCashVoucher {
  id: string; voucherNo: number; amount: number; status: string;
}

interface Dispatch {
  id: string; shipmentNo: number; date: string; vehicleNo: string; customerName: string;
  weightTare: number | null; weightGross: number | null; weightNet: number | null; bags: number | null;
  status: string; gateInTime: string | null; grossTime: string | null; releaseTime: string | null;
  productName: string; invoiceRef: string | null; remarks: string | null;
  driverName: string | null; driverMobile: string | null; transporterName: string | null; destination: string | null;
  invoice: DispatchInvoice | null;
  cashVoucher: DispatchCashVoucher | null;
}

interface Pipeline {
  atWeighbridge: number; atWeighbridgeVehicles: string; totalDispatches: number; dispatched: number;
  invoiced: number; irnGenerated: number; ewbGenerated: number; outstanding: number;
}

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

  // Invoice generation modal
  const [invoiceModal, setInvoiceModal] = useState<{ orderId: string; dispatch: Dispatch } | null>(null);
  const [invForm, setInvForm] = useState({ rate: '', gstPercent: '18', invoicePercent: '100' });
  const [invSaving, setInvSaving] = useState(false);

  // EWB modal
  const [ewbModal, setEwbModal] = useState<{ orderId: string; dispatch: Dispatch } | null>(null);
  const [ewbForm, setEwbForm] = useState({ distanceKm: '100', transporterGstin: '' });
  const [ewbSaving, setEwbSaving] = useState(false);

  // Manual EWB
  const [manualEwb, setManualEwb] = useState<{ orderId: string; shipmentId: string; ewbNo: string; file: File | null } | null>(null);

  // Action loading
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Invoice detail row
  const [showIrnDetail, setShowIrnDetail] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

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
      customerId: o.customerId || '', buyerName: o.buyerName, buyerPhone: o.buyerPhone || '',
      buyerAddress: o.buyerAddress || '', productName: o.productName, rate: String(o.rate),
      unit: o.unit, quantity: o.quantity ? String(o.quantity) : '',
      validFrom: o.validFrom?.split('T')[0] || '', validTo: o.validTo?.split('T')[0] || '',
      remarks: o.remarks || '',
    });
    setShowForm(true);
  }

  async function handleSave() {
    if (!form.buyerName.trim()) { setMsg({ type: 'err', text: 'Select a buyer' }); return; }
    setSaving(true); setMsg(null);
    try {
      if (editId) {
        await api.put(`/direct-sales/${editId}`, form);
        setMsg({ type: 'ok', text: 'Order updated' });
      } else {
        await api.post('/direct-sales', form);
        setMsg({ type: 'ok', text: 'Order created' });
      }
      setForm({ ...emptyForm }); setShowForm(false); setEditId(null); fetchData();
    } catch (err: any) { setMsg({ type: 'err', text: err.response?.data?.error || 'Save failed' }); }
    setSaving(false);
    setTimeout(() => setMsg(null), 3000);
  }

  async function handleStatusChange(id: string, status: string) {
    try { await api.put(`/direct-sales/${id}`, { status }); fetchData(); } catch { /* */ }
  }

  async function toggleExpand(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id); setLoadingDispatches(true);
    try {
      const res = await api.get(`/direct-sales/${id}/dispatches`);
      setDispatches(res.data.shipments || []);
      setPipeline(res.data.pipeline || null);
    } catch { setDispatches([]); setPipeline(null); }
    setLoadingDispatches(false);
  }

  async function refreshDispatches(orderId: string) {
    try {
      const res = await api.get(`/direct-sales/${orderId}/dispatches`);
      setDispatches(res.data.shipments || []);
      setPipeline(res.data.pipeline || null);
    } catch { /* */ }
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this order?')) return;
    try { await api.delete(`/direct-sales/${id}`); fetchData(); } catch { /* */ }
  }

  // ── Invoice generation ──
  function openInvoiceModal(orderId: string, d: Dispatch) {
    setInvoiceModal({ orderId, dispatch: d });
    setInvForm({ rate: '', gstPercent: '18', invoicePercent: '100' });
  }

  async function handleCreateInvoice() {
    if (!invoiceModal) return;
    const rate = parseFloat(invForm.rate);
    if (!rate || rate <= 0) { setError('Rate is required'); return; }
    setInvSaving(true); setError(null);
    try {
      await api.post(`/direct-sales/${invoiceModal.orderId}/shipments/${invoiceModal.dispatch.id}/create-invoice`, {
        rate,
        gstPercent: parseFloat(invForm.gstPercent) || 18,
        invoicePercent: parseFloat(invForm.invoicePercent) || 100,
      });
      setInvoiceModal(null);
      refreshDispatches(invoiceModal.orderId);
      fetchData();
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to create invoice'); }
    setInvSaving(false);
  }

  // ── E-Invoice (IRN + EWB) ──
  function openEwbModal(orderId: string, d: Dispatch) {
    setEwbModal({ orderId, dispatch: d });
    setEwbForm({ distanceKm: '100', transporterGstin: '' });
  }

  async function handleGenerateEInvoice() {
    if (!ewbModal) return;
    setEwbSaving(true); setError(null);
    try {
      const res = await api.post(`/direct-sales/${ewbModal.orderId}/shipments/${ewbModal.dispatch.id}/e-invoice`, ewbForm);
      setEwbModal(null);
      refreshDispatches(ewbModal.orderId);
      if (res.data.ewbError) setError(`IRN OK. EWB failed: ${res.data.ewbError}`);
    } catch (err: any) { setError(err.response?.data?.error || 'E-invoice generation failed'); }
    setEwbSaving(false);
  }

  // ── Manual EWB ──
  async function handleSaveManualEwb(orderId: string, shipmentId: string) {
    if (!manualEwb?.ewbNo.trim()) return;
    setActionLoading(shipmentId);
    try {
      const formData = new FormData();
      formData.append('ewbNo', manualEwb.ewbNo);
      if (manualEwb.file) formData.append('ewbPdf', manualEwb.file);
      await api.patch(`/direct-sales/${orderId}/shipments/${shipmentId}/manual-ewb`, formData);
      setManualEwb(null);
      refreshDispatches(orderId);
    } catch (err: any) { setError(err.response?.data?.error || 'Failed to save EWB'); }
    setActionLoading(null);
  }

  // ── PDF downloads ──
  async function openPdf(url: string, label: string) {
    try {
      const res = await api.get(url, { responseType: 'blob' });
      window.open(URL.createObjectURL(res.data), '_blank');
    } catch { setError(`Failed to load ${label}`); }
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
        {/* Error toast */}
        {error && (
          <div className="fixed top-4 right-4 z-50 bg-red-600 text-white px-4 py-2 text-xs max-w-md shadow-2xl">
            {error}
            <button onClick={() => setError(null)} className="ml-3 font-bold">X</button>
          </div>
        )}

        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Scrap & Misc Sales</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Orders, Dispatch & Documents</span>
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
                  <label className={labelCls}>Base Rate</label>
                  <input name="rate" type="number" step="any" value={form.rate} onChange={handleFormChange} className={inputCls} placeholder="Optional" />
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
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Unit</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Valid</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Supplied</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {orders.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No orders found</td></tr>
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
                    <td className="px-3 py-1.5 text-center text-slate-500 border-r border-slate-100">{o.unit}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">
                      <span className="text-slate-600">{fmtDate(o.validFrom)}</span>
                      <span className="text-slate-400 mx-0.5">-</span>
                      <span className="text-slate-600">{fmtDate(o.validTo)}</span>
                      {daysLeft !== null && daysLeft >= 0 && daysLeft <= 2 && o.status === 'ACTIVE' && (
                        <span className="text-[9px] text-amber-600 font-bold ml-1">{daysLeft}d</span>
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
                      <div className="flex items-center justify-center gap-1" onClick={e => e.stopPropagation()}>
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
                      <td colSpan={8} className="bg-slate-50 border-b border-slate-200 p-0">
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
                            </div>
                          )}

                          {/* Pipeline KPIs */}
                          {pipeline && (
                            <div className="grid grid-cols-3 md:grid-cols-6 gap-0 border border-slate-300 mb-3">
                              <div className={`px-3 py-2 border-r border-slate-300 ${pipeline.atWeighbridge > 0 ? 'bg-orange-50' : 'bg-white'}`}>
                                <div className={`text-[10px] font-bold uppercase tracking-widest ${pipeline.atWeighbridge > 0 ? 'text-orange-600' : 'text-slate-400'}`}>At WB</div>
                                <div className="text-lg font-bold text-slate-800 font-mono">{pipeline.atWeighbridge}</div>
                                {pipeline.atWeighbridgeVehicles && <div className="text-[9px] text-orange-500 mt-0.5 truncate max-w-[100px]">{pipeline.atWeighbridgeVehicles}</div>}
                              </div>
                              <div className="bg-white px-3 py-2 border-r border-slate-300">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Dispatches</div>
                                <div className="text-lg font-bold text-slate-800 font-mono">{pipeline.totalDispatches}</div>
                              </div>
                              <div className="bg-white px-3 py-2 border-r border-slate-300">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Invoiced</div>
                                <div className="text-lg font-bold text-slate-800 font-mono">{pipeline.invoiced}</div>
                                {pipeline.totalDispatches > pipeline.invoiced && <div className="text-[9px] text-amber-500">{pipeline.totalDispatches - pipeline.invoiced} pending</div>}
                              </div>
                              <div className="bg-white px-3 py-2 border-r border-slate-300">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">IRN</div>
                                <div className="text-lg font-bold text-slate-800 font-mono">{pipeline.irnGenerated}</div>
                              </div>
                              <div className="bg-white px-3 py-2 border-r border-slate-300">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">EWB</div>
                                <div className="text-lg font-bold text-slate-800 font-mono">{pipeline.ewbGenerated}</div>
                              </div>
                              <div className="bg-white px-3 py-2">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Outstanding</div>
                                <div className="text-lg font-bold text-slate-800 font-mono">{fmtCurrency(pipeline.outstanding)}</div>
                              </div>
                            </div>
                          )}

                          {/* Dispatch table */}
                          {loadingDispatches ? (
                            <div className="text-xs text-slate-400 uppercase tracking-widest py-4 text-center">Loading dispatches...</div>
                          ) : dispatches.length === 0 ? (
                            <div className="text-xs text-slate-400 uppercase tracking-widest py-4 text-center">No dispatches yet</div>
                          ) : (
                            <div className="overflow-x-auto">
                            <table className="w-full text-xs border border-slate-300 min-w-[1000px]">
                              <thead>
                                <tr className="bg-slate-700 text-white">
                                  <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">Date</th>
                                  <th className="text-left px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">Vehicle</th>
                                  <th className="text-right px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">Net (kg)</th>
                                  <th className="text-center px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">Status</th>
                                  <th className="text-center px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">Invoice</th>
                                  <th className="text-center px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">IRN</th>
                                  <th className="text-center px-2 py-1.5 text-[9px] uppercase tracking-widest border-r border-slate-600">EWB</th>
                                  <th className="text-center px-2 py-1.5 text-[9px] uppercase tracking-widest">Actions</th>
                                </tr>
                              </thead>
                              <tbody>
                                {dispatches.map((d, di) => (
                                  <React.Fragment key={d.id}>
                                  <tr className={`border-b border-slate-100 hover:bg-blue-50/60 ${di % 2 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                    <td className="px-2 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(d.date)}</td>
                                    <td className="px-2 py-1.5 border-r border-slate-100 font-medium">{d.vehicleNo}</td>
                                    <td className="px-2 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">
                                      {(d.weightNet || 0) > 0 ? (d.weightNet || 0).toLocaleString('en-IN') : '--'}
                                    </td>
                                    <td className="px-2 py-1.5 text-center border-r border-slate-100">
                                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                        d.status === 'RELEASED' || d.status === 'DELIVERED' ? 'bg-green-50 text-green-700 border-green-200' :
                                        d.status === 'GROSS_WEIGHED' ? 'bg-blue-50 text-blue-700 border-blue-200' :
                                        'bg-amber-50 text-amber-700 border-amber-200'
                                      }`}>{d.status.replace(/_/g, ' ')}</span>
                                    </td>

                                    {/* Invoice column */}
                                    <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                      {d.invoice ? (
                                        <button onClick={(e) => { e.stopPropagation(); setShowIrnDetail(showIrnDetail === d.id ? null : d.id); }}
                                          className="text-[10px] font-medium text-blue-700 underline hover:text-blue-900 cursor-pointer">
                                          {d.invoice.remarks || `INV-${d.invoice.invoiceNo}`}
                                        </button>
                                      ) : (d.weightNet || 0) > 0 ? (
                                        <button onClick={(e) => { e.stopPropagation(); openInvoiceModal(o.id, d); }}
                                          className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100">
                                          Gen Invoice
                                        </button>
                                      ) : <span className="text-slate-300">--</span>}
                                    </td>

                                    {/* IRN column */}
                                    <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                      {d.invoice?.irnStatus === 'GENERATED' ? (
                                        <button onClick={(e) => { e.stopPropagation(); setShowIrnDetail(showIrnDetail === d.id ? null : d.id); }}
                                          className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700 hover:bg-green-100">IRN</button>
                                      ) : d.invoice ? (
                                        <button onClick={(e) => { e.stopPropagation(); openEwbModal(o.id, d); }}
                                          disabled={actionLoading === d.id}
                                          className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                                          Gen
                                        </button>
                                      ) : <span className="text-slate-300">--</span>}
                                    </td>

                                    {/* EWB column */}
                                    <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                                      {d.invoice?.ewbStatus === 'GENERATED' && manualEwb?.shipmentId !== d.id ? (
                                        <button onClick={(e) => { e.stopPropagation(); setManualEwb({ orderId: o.id, shipmentId: d.id, ewbNo: d.invoice!.ewbNo || '', file: null }); }}
                                          className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700 hover:bg-green-100" title={d.invoice.ewbNo || ''}>EWB</button>
                                      ) : (d.invoice?.irnStatus === 'GENERATED' || d.invoice?.ewbStatus === 'GENERATED') ? (
                                        manualEwb?.shipmentId === d.id ? (
                                          <div className="flex flex-col gap-1" onClick={e => e.stopPropagation()}>
                                            <div className="flex items-center gap-0.5">
                                              <input type="text" value={manualEwb.ewbNo} onChange={e => setManualEwb({ ...manualEwb, ewbNo: e.target.value })}
                                                placeholder="EWB No" className="border border-slate-300 px-1 py-0.5 text-[9px] w-24 focus:outline-none focus:ring-1 focus:ring-blue-400"
                                                onKeyDown={e => { if (e.key === 'Enter') handleSaveManualEwb(o.id, d.id); }} autoFocus />
                                              <button onClick={() => handleSaveManualEwb(o.id, d.id)} disabled={actionLoading === d.id}
                                                className="text-[8px] font-bold px-1 py-0.5 border border-green-400 bg-green-500 text-white hover:bg-green-600 disabled:opacity-50">OK</button>
                                              <button onClick={() => setManualEwb(null)} className="text-[8px] px-0.5 text-slate-400 hover:text-slate-600">X</button>
                                            </div>
                                            <label className="flex items-center gap-1 text-[8px] text-slate-500 cursor-pointer">
                                              <input type="file" accept=".pdf" className="hidden" onChange={e => setManualEwb({ ...manualEwb, file: e.target.files?.[0] || null })} />
                                              <span className="border border-slate-300 px-1 py-0.5 bg-white hover:bg-slate-50">{manualEwb.file ? manualEwb.file.name.slice(0, 15) : 'Attach PDF'}</span>
                                            </label>
                                          </div>
                                        ) : (
                                          <div className="flex items-center gap-0.5 justify-center">
                                            <button onClick={(e) => { e.stopPropagation(); openEwbModal(o.id, d); }}
                                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100">Gen</button>
                                            <button onClick={(e) => { e.stopPropagation(); setManualEwb({ orderId: o.id, shipmentId: d.id, ewbNo: '', file: null }); }}
                                              className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-300 bg-blue-50 text-blue-700 hover:bg-blue-100">Enter</button>
                                          </div>
                                        )
                                      ) : <span className="text-slate-300">--</span>}
                                    </td>

                                    {/* Actions column */}
                                    <td className="px-2 py-1.5 text-center">
                                      <div className="flex items-center justify-center gap-1 flex-wrap" onClick={e => e.stopPropagation()}>
                                        {d.invoice && (
                                          <button onClick={() => openPdf(`/invoices/${d.invoice!.id}/pdf`, 'invoice')}
                                            className="text-[8px] font-bold uppercase px-1 py-0.5 border border-slate-300 bg-slate-50 text-slate-600 hover:bg-slate-100" title="Print Invoice">INV</button>
                                        )}
                                        <button onClick={() => openPdf(`/direct-sales/${o.id}/shipments/${d.id}/challan-pdf`, 'challan')}
                                          className="text-[8px] font-bold uppercase px-1 py-0.5 border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100" title="Delivery Challan">DCH</button>
                                        <button onClick={() => openPdf(`/direct-sales/${o.id}/shipments/${d.id}/gate-pass-pdf`, 'gate pass')}
                                          className="text-[8px] font-bold uppercase px-1 py-0.5 border border-purple-300 bg-purple-50 text-purple-700 hover:bg-purple-100" title="Gate Pass">GP</button>
                                        {d.invoice?.ewbNo && (
                                          <button onClick={() => openPdf(`/direct-sales/${o.id}/shipments/${d.id}/ewb-pdf`, 'EWB PDF')}
                                            className="text-[8px] font-bold uppercase px-1 py-0.5 border border-green-300 bg-green-50 text-green-600 hover:bg-green-100" title="E-Way Bill PDF">EWB</button>
                                        )}
                                      </div>
                                    </td>
                                  </tr>

                                  {/* Invoice detail row */}
                                  {showIrnDetail === d.id && d.invoice && (
                                    <tr>
                                      <td colSpan={8} className="p-0 border-b-2 border-slate-300">
                                        <div className="bg-slate-800 text-white px-3 py-1.5 flex items-center justify-between">
                                          <span className="text-[10px] font-bold uppercase tracking-widest">{d.invoice.remarks || `INV-${d.invoice.invoiceNo}`}</span>
                                          <div className="flex items-center gap-2">
                                            {d.cashVoucher && (
                                              <span className="text-[9px] font-bold px-1.5 py-0.5 border border-amber-500 bg-amber-900/50 text-amber-300">
                                                Cash: {fmtCurrency(d.cashVoucher.amount)} (CV-{d.cashVoucher.voucherNo})
                                              </span>
                                            )}
                                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                              d.invoice.status === 'PAID' ? 'bg-green-900/50 text-green-300 border-green-600' :
                                              d.invoice.status === 'PARTIAL' ? 'bg-amber-900/50 text-amber-300 border-amber-600' :
                                              'bg-red-900/50 text-red-300 border-red-600'
                                            }`}>{d.invoice.status}</span>
                                          </div>
                                        </div>
                                        <div className="bg-slate-50 px-3 py-2 text-[10px] border-l-4 border-l-blue-500">
                                          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-x-6 gap-y-1.5">
                                            <div>
                                              <span className="font-bold text-slate-400 uppercase tracking-widest">Product</span>
                                              <div className="font-medium text-slate-700 mt-0.5">{d.invoice.productName}</div>
                                            </div>
                                            <div>
                                              <span className="font-bold text-slate-400 uppercase tracking-widest">Qty</span>
                                              <div className="font-mono text-slate-700 mt-0.5">{d.invoice.quantity?.toLocaleString('en-IN')} {d.invoice.unit}</div>
                                            </div>
                                            <div>
                                              <span className="font-bold text-slate-400 uppercase tracking-widest">Rate</span>
                                              <div className="font-mono text-slate-700 mt-0.5">{fmtCurrency(d.invoice.rate)}/{o.unit}</div>
                                            </div>
                                            <div>
                                              <span className="font-bold text-slate-400 uppercase tracking-widest">Amount</span>
                                              <div className="font-mono text-slate-700 mt-0.5">{fmtCurrency(d.invoice.amount)}</div>
                                            </div>
                                            <div>
                                              <span className="font-bold text-slate-400 uppercase tracking-widest">GST ({d.invoice.gstPercent}%)</span>
                                              <div className="font-mono text-slate-700 mt-0.5">
                                                {fmtCurrency(d.invoice.gstAmount)}
                                                <span className="text-slate-400 ml-1">
                                                  ({d.invoice.supplyType === 'INTER_STATE' ? `IGST` : `C+S`})
                                                </span>
                                              </div>
                                            </div>
                                            <div>
                                              <span className="font-bold text-slate-400 uppercase tracking-widest">Total</span>
                                              <div className="font-mono font-bold text-slate-800 mt-0.5">{fmtCurrency(d.invoice.totalAmount)}</div>
                                            </div>
                                          </div>
                                          {(d.invoice.irn || d.invoice.ewbNo) && (
                                            <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1.5 mt-2 pt-2 border-t border-slate-200">
                                              {d.invoice.irn && (
                                                <div className="col-span-2">
                                                  <span className="font-bold text-slate-400 uppercase tracking-widest">IRN</span>
                                                  <div className="font-mono text-[9px] text-slate-600 mt-0.5 break-all">{d.invoice.irn}</div>
                                                </div>
                                              )}
                                              {d.invoice.ewbNo && (
                                                <div>
                                                  <span className="font-bold text-slate-400 uppercase tracking-widest">E-Way Bill</span>
                                                  <div className="font-mono text-slate-700 mt-0.5">{d.invoice.ewbNo}</div>
                                                </div>
                                              )}
                                            </div>
                                          )}
                                        </div>
                                      </td>
                                    </tr>
                                  )}
                                  </React.Fragment>
                                ))}
                              </tbody>
                            </table>
                            </div>
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

        {/* ── Invoice Generation Modal ── */}
        {invoiceModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setInvoiceModal(null)}>
            <div className="bg-white shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest">Generate Invoice</span>
                <button onClick={() => setInvoiceModal(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>
              <div className="p-4 space-y-3">
                <div className="bg-slate-50 border border-slate-200 px-3 py-2 text-[10px]">
                  <div className="grid grid-cols-2 gap-2">
                    <div><span className="font-bold text-slate-400 uppercase tracking-widest">Vehicle</span><div className="font-medium text-slate-700">{invoiceModal.dispatch.vehicleNo}</div></div>
                    <div><span className="font-bold text-slate-400 uppercase tracking-widest">Net Weight</span><div className="font-mono text-slate-700">{(invoiceModal.dispatch.weightNet || 0).toLocaleString('en-IN')} kg</div></div>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className={labelCls}>Rate *</label>
                    <input type="number" step="any" value={invForm.rate} onChange={e => setInvForm(p => ({ ...p, rate: e.target.value }))}
                      className={inputCls} placeholder="Per unit" autoFocus />
                  </div>
                  <div>
                    <label className={labelCls}>GST %</label>
                    <input type="number" step="any" value={invForm.gstPercent} onChange={e => setInvForm(p => ({ ...p, gstPercent: e.target.value }))}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Invoice %</label>
                    <input type="number" step="1" min="0" max="100" value={invForm.invoicePercent}
                      onChange={e => setInvForm(p => ({ ...p, invoicePercent: e.target.value }))}
                      className={inputCls} />
                  </div>
                </div>

                {/* Split preview */}
                {invForm.rate && parseFloat(invForm.rate) > 0 && (() => {
                  const netKg = invoiceModal.dispatch.weightNet || 0;
                  const r = parseFloat(invForm.rate);
                  const total = netKg * r;
                  const pct = Math.max(0, Math.min(100, parseFloat(invForm.invoicePercent) || 100));
                  const gstPct = parseFloat(invForm.gstPercent) || 18;
                  const invAmt = Math.round(total * pct / 100);
                  const gstAmt = Math.round(invAmt * gstPct / 100);
                  const cashAmt = Math.round(total * (100 - pct) / 100);
                  return (
                    <div className="border border-slate-200 bg-slate-50 p-3 space-y-2 text-[10px]">
                      <div className="flex justify-between">
                        <span className="font-bold text-slate-500 uppercase tracking-widest">Total Value</span>
                        <span className="font-mono font-bold text-slate-800">{fmtCurrency(total)}</span>
                      </div>
                      {pct > 0 && (
                        <div className="flex justify-between text-blue-700">
                          <span className="font-bold uppercase tracking-widest">Invoice ({pct}%)</span>
                          <span className="font-mono font-bold">{fmtCurrency(invAmt)} + {fmtCurrency(gstAmt)} GST = {fmtCurrency(invAmt + gstAmt)}</span>
                        </div>
                      )}
                      {pct < 100 && (
                        <div className="flex justify-between text-amber-700">
                          <span className="font-bold uppercase tracking-widest">Cash Voucher ({100 - pct}%)</span>
                          <span className="font-mono font-bold">{fmtCurrency(cashAmt)}</span>
                        </div>
                      )}
                    </div>
                  );
                })()}

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button onClick={() => setInvoiceModal(null)}
                    className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                  <button onClick={handleCreateInvoice} disabled={invSaving}
                    className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                    {invSaving ? 'Creating...' : 'Create Invoice'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── EWB Modal ── */}
        {ewbModal && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setEwbModal(null)}>
            <div className="bg-white shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest">Generate e-Invoice + EWB</span>
                <button onClick={() => setEwbModal(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>
              <div className="p-4 space-y-3">
                <div className="bg-slate-50 border border-slate-200 px-3 py-2 text-[10px]">
                  <div className="font-medium text-slate-700">{ewbModal.dispatch.vehicleNo} - {ewbModal.dispatch.invoice?.remarks || `INV-${ewbModal.dispatch.invoice?.invoiceNo}`}</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={labelCls}>Distance (km)</label>
                    <input type="number" value={ewbForm.distanceKm} onChange={e => setEwbForm(p => ({ ...p, distanceKm: e.target.value }))}
                      className={inputCls} />
                  </div>
                  <div>
                    <label className={labelCls}>Transporter GSTIN</label>
                    <input type="text" value={ewbForm.transporterGstin} onChange={e => setEwbForm(p => ({ ...p, transporterGstin: e.target.value }))}
                      className={inputCls} placeholder="Optional" />
                  </div>
                </div>
                <div className="flex items-center justify-end gap-2 pt-2">
                  <button onClick={() => setEwbModal(null)}
                    className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                  <button onClick={handleGenerateEInvoice} disabled={ewbSaving}
                    className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                    {ewbSaving ? 'Generating...' : 'Generate'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
