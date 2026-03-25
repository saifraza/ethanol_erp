import { useState, useEffect } from 'react';
import { ClipboardList, Plus, X, Save, Loader2, Trash2, ChevronDown, Truck, FileText, Send, CheckCircle, Clock, ArrowRight, RotateCcw } from 'lucide-react';
import api from '../../services/api';

interface Customer { id: string; name: string; }
interface Product { id: string; name: string; defaultRate: number; gstPercent: number; unit: string; }

interface LineItem {
  productName: string; productId?: string; quantity: number; unit: string; rate: number; gstPercent: number;
  amount?: number; gst?: number; total?: number;
}

interface DR { id: string; drNo: number; status: string; quantity: number; }
interface Shipment { id: string; status: string; vehicleNo: string; weightNet: number | null; }
interface Invoice { id: string; invoiceNo: number; status: string; totalAmount: number; }

interface SalesOrder {
  id: string; orderNo: string; customerId: string; customerName: string;
  orderDate: string; deliveryDate: string; poNumber?: string;
  paymentTerms: string; logisticsBy: string; freightRate?: number;
  lineItems: LineItem[]; lines?: LineItem[]; remarks?: string; status: string;
  grandTotal?: number; totalGst?: number; totalAmount?: number;
  dispatchRequests?: DR[]; shipments?: any[]; invoices?: Invoice[];
}

export default function SalesOrders() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [filterStatus, setFilterStatus] = useState('ALL');

  // Form
  const [customerId, setCustomerId] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [paymentTerms, setPaymentTerms] = useState('NET15');
  const [logisticsBy, setLogisticsBy] = useState('BUYER');
  const [freightRate, setFreightRate] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([
    { productName: 'DDGS', quantity: 0, unit: 'MT', rate: 0, gstPercent: 5 }
  ]);
  const [remarks, setRemarks] = useState('');

  const loadAll = async () => {
    try {
      setLoading(true);
      const [ordRes, custRes, prodRes] = await Promise.all([
        api.get('/sales-orders'),
        api.get('/customers'),
        api.get('/products'),
      ]);
      const rawOrders = ordRes.data.orders || ordRes.data || [];
      const normalized = rawOrders.map((o: any) => ({
        ...o,
        customerName: o.customerName || o.customer?.name || '',
        lineItems: o.lineItems || o.lines || [],
      }));
      setOrders(normalized);
      setCustomers(custRes.data.customers || custRes.data || []);
      setProducts(prodRes.data.products || prodRes.data || []);
    } catch {
      setMsg({ type: 'err', text: 'Failed to load data' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAll(); }, []);

  const flash = (type: 'ok' | 'err', text: string) => {
    setMsg({ type, text });
    setTimeout(() => setMsg(null), 4000);
  };

  const calcTotals = (items: LineItem[]) => {
    let amt = 0, gst = 0;
    items.forEach(i => { const a = i.quantity * i.rate; amt += a; gst += a * (i.gstPercent / 100); });
    return { totalAmount: amt, totalGst: gst, grandTotal: amt + gst };
  };
  const totals = calcTotals(lineItems);

  const resetForm = () => {
    setCustomerId(''); setPaymentTerms('NET15'); setLogisticsBy('BUYER');
    setFreightRate(''); setRemarks('');
    setLineItems([{ productName: 'DDGS', quantity: 0, unit: 'MT', rate: 0, gstPercent: 5 }]);
    const d = new Date(); d.setDate(d.getDate() + 7);
    setDeliveryDate(d.toISOString().split('T')[0]);
    setShowForm(false);
  };

  const handleProductChange = (idx: number, productName: string) => {
    const prod = products.find(p => p.name === productName);
    const updated = [...lineItems];
    updated[idx] = {
      ...updated[idx],
      productName,
      productId: prod?.id,
      rate: prod?.defaultRate || updated[idx].rate,
      gstPercent: prod?.gstPercent ?? updated[idx].gstPercent,
      unit: prod?.unit === 'TON' ? 'MT' : (prod?.unit === 'KL' ? 'KL' : updated[idx].unit),
    };
    setLineItems(updated);
  };

  const createOrder = async () => {
    if (!customerId) { flash('err', 'Select customer'); return; }
    if (!lineItems.some(i => i.quantity > 0)) { flash('err', 'Add quantity'); return; }
    setSaving(true);
    try {
      const validLines = lineItems.filter(i => i.quantity > 0);
      const res = await api.post('/sales-orders', {
        customerId, orderDate: new Date().toISOString().split('T')[0], deliveryDate,
        paymentTerms, logisticsBy,
        freightRate: logisticsBy === 'SELLER' ? parseFloat(freightRate) : undefined,
        lineItems: validLines, remarks,
      });
      const soId = res.data.id;
      const orderNo = res.data.orderNo;
      await api.put(`/sales-orders/${soId}/status`, { status: 'CONFIRMED' });
      const line = validLines[0];
      await api.post('/dispatch-requests', {
        orderId: soId, customerId,
        productName: line?.productName || 'DDGS',
        quantity: line?.quantity || 0, unit: line?.unit || 'MT',
        logisticsBy, deliveryDate, remarks: remarks || '',
      });
      flash('ok', `Order #${orderNo} created -> sent to logistics`);
      resetForm();
      loadAll();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed to create order');
    } finally {
      setSaving(false);
    }
  };

  const sendToFactory = async (order: SalesOrder) => {
    setActionLoading(order.id + '_send');
    try {
      const line = order.lineItems?.[0] || order.lines?.[0];
      await api.post('/dispatch-requests', {
        orderId: order.id, customerId: order.customerId,
        productName: line?.productName || 'DDGS',
        quantity: line?.quantity || 0, unit: line?.unit || 'MT',
        remarks: order.remarks || '',
      });
      flash('ok', `Sent to logistics for Order #${order.orderNo}`);
      loadAll();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed to send to factory');
    } finally {
      setActionLoading(null);
    }
  };

  const createInvoice = async (order: SalesOrder, shipment: any) => {
    setActionLoading(order.id + '_inv');
    try {
      const line = order.lineItems?.[0] || order.lines?.[0];
      const netTons = shipment.weightNet ? shipment.weightNet / 1000 : (line?.quantity || 0);
      const rate = line?.rate || 0;
      const gstPct = line?.gstPercent || 5;
      const freight = order.logisticsBy === 'SELLER' ? netTons * (order.freightRate || 0) : 0;
      await api.post('/invoices', {
        customerId: order.customerId, orderId: order.id, shipmentId: shipment.id,
        productName: line?.productName || 'DDGS', quantity: netTons, unit: line?.unit || 'MT',
        rate, gstPercent: gstPct, freightCharge: freight,
        invoiceDate: new Date().toISOString().split('T')[0],
        challanNo: shipment.challanNo || '', ewayBill: shipment.ewayBill || '',
      });
      flash('ok', 'Invoice created from shipment');
      loadAll();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed to create invoice');
    } finally {
      setActionLoading(null);
    }
  };

  const cancelOrder = async (order: SalesOrder) => {
    if (!confirm('Cancel this order?')) return;
    setActionLoading(order.id + '_cancel');
    try {
      await api.put(`/sales-orders/${order.id}/status`, { status: 'CANCELLED' });
      flash('ok', 'Order cancelled');
      loadAll();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed');
    } finally {
      setActionLoading(null);
    }
  };

  const deleteOrder = async (order: SalesOrder) => {
    if (!confirm(`Delete order #${order.orderNo}? This cannot be undone.`)) return;
    setActionLoading(order.id + '_del');
    try {
      await api.delete(`/sales-orders/${order.id}`);
      flash('ok', `Order #${order.orderNo} deleted`);
      loadAll();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed to delete');
    } finally {
      setActionLoading(null);
    }
  };

  const getPipeline = (order: SalesOrder) => {
    const drs = order.dispatchRequests || [];
    const hasDR = drs.length > 0;
    const latestDR = drs[drs.length - 1];
    let shipments: any[] = [];
    drs.forEach((dr: any) => { if (dr.shipments) shipments.push(...dr.shipments); });
    if (order.shipments) shipments.push(...order.shipments);
    const latestShipment = shipments[shipments.length - 1];
    const shipmentDone = latestShipment && ['RELEASED', 'EXITED'].includes(latestShipment.status);
    const dispatchedKg = shipments
      .filter((s: any) => s.weightNet && ['RELEASED', 'EXITED'].includes(s.status))
      .reduce((sum: number, s: any) => sum + (s.weightNet || 0), 0);
    const dispatchedMT = dispatchedKg / 1000;
    const orderedQty = (order.lineItems?.[0] || (order as any).lines?.[0])?.quantity || 0;
    const dispatchPct = orderedQty > 0 ? Math.min((dispatchedMT / orderedQty) * 100, 100) : 0;
    const invoices = order.invoices || [];
    const hasInvoice = invoices.length > 0;
    const latestInvoice = invoices[invoices.length - 1];
    return { hasDR, latestDR, shipments, latestShipment, shipmentDone, hasInvoice, latestInvoice, dispatchedMT, orderedQty, dispatchPct };
  };

  const filteredOrders = orders.filter(o =>
    filterStatus === 'ALL' || o.status === filterStatus
  ).sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

  const stats = {
    total: orders.length,
    active: orders.filter(o => ['CONFIRMED', 'IN_PROGRESS'].includes(o.status)).length,
    value: orders.filter(o => !['CANCELLED'].includes(o.status)).reduce((s, o) => s + (o.grandTotal || 0), 0),
  };

  const getStatusBadge = (status: string) => {
    const map: Record<string, string> = {
      CONFIRMED: 'bg-blue-50 text-blue-700 border-blue-200',
      IN_PROGRESS: 'bg-amber-50 text-amber-700 border-amber-200',
      COMPLETED: 'bg-green-50 text-green-700 border-green-200',
      CANCELLED: 'bg-red-50 text-red-700 border-red-200',
    };
    return map[status] || 'bg-slate-50 text-slate-600 border-slate-200';
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ClipboardList size={18} />
            <span className="text-sm font-bold tracking-wide uppercase">Sales Orders</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">{new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={loadAll} className="p-1.5 hover:bg-slate-700 transition text-slate-300" title="Refresh">
              <RotateCcw size={14} />
            </button>
            {!showForm && (
              <button onClick={() => setShowForm(true)}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1.5">
                <Plus size={12} /> New Sale
              </button>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="border-l-4 border-l-blue-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Orders</div>
            <div className="text-xl font-bold text-slate-800">{stats.total}</div>
          </div>
          <div className="border-l-4 border-l-amber-500 border-r border-slate-300 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Active Orders</div>
            <div className="text-xl font-bold text-slate-800">{stats.active}</div>
          </div>
          <div className="border-l-4 border-l-green-500 bg-white px-4 py-3">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Value</div>
            <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">{(stats.value / 100000).toFixed(1)}L</div>
          </div>
        </div>

        {/* Messages */}
        {msg && (
          <div className={`p-3 text-xs border-x border-b -mx-3 md:-mx-6 flex items-center gap-2 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'}`}>
            {msg.type === 'ok' ? <CheckCircle size={14} /> : <X size={14} />}
            {msg.text}
          </div>
        )}

        {/* Quick Create Form */}
        {showForm && (
          <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white shadow-2xl">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h3 className="text-sm font-bold tracking-wide uppercase">Quick Sale Order</h3>
              <button onClick={resetForm} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>

            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Customer *</label>
                  <select value={customerId} onChange={e => setCustomerId(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="">Select Party</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Delivery By</label>
                  <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment</label>
                  <select value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="ADVANCE">Advance</option>
                    <option value="COD">COD</option>
                    <option value="NET7">7 Days</option>
                    <option value="NET15">15 Days</option>
                    <option value="NET30">30 Days</option>
                  </select>
                </div>
              </div>

              {/* Line Items */}
              {lineItems.map((item, idx) => (
                <div key={idx} className="bg-slate-50 p-3 border border-slate-200">
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Product</label>
                      <select value={item.productName} onChange={e => handleProductChange(idx, e.target.value)}
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                        <option value="DDGS">DDGS</option>
                        <option value="ETHANOL">Ethanol</option>
                        <option value="LFO">LFO</option>
                        <option value="HFO">HFO</option>
                        <option value="RS">RS</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Qty</label>
                      <input type="number" value={item.quantity || ''} placeholder="300"
                        onChange={e => { const u = [...lineItems]; u[idx] = { ...u[idx], quantity: parseFloat(e.target.value) || 0 }; setLineItems(u); }}
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Unit</label>
                      <select value={item.unit} onChange={e => { const u = [...lineItems]; u[idx] = { ...u[idx], unit: e.target.value }; setLineItems(u); }}
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                        <option value="MT">MT</option>
                        <option value="KL">KL</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Rate (/unit)</label>
                      <input type="number" value={item.rate || ''} placeholder="18000"
                        onChange={e => { const u = [...lineItems]; u[idx] = { ...u[idx], rate: parseFloat(e.target.value) || 0 }; setLineItems(u); }}
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GST %</label>
                      <input type="number" value={item.gstPercent}
                        onChange={e => { const u = [...lineItems]; u[idx] = { ...u[idx], gstPercent: parseFloat(e.target.value) || 0 }; setLineItems(u); }}
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <div className="flex items-end gap-1">
                      <div className="flex-1 text-right">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Amount</label>
                        <div className="text-sm font-bold text-slate-800 font-mono tabular-nums">
                          {(item.quantity * item.rate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                      </div>
                      {lineItems.length > 1 && (
                        <button onClick={() => setLineItems(lineItems.filter((_, i) => i !== idx))}
                          className="text-red-400 hover:text-red-600 pb-1"><Trash2 size={14} /></button>
                      )}
                    </div>
                  </div>
                </div>
              ))}

              <button onClick={() => setLineItems([...lineItems, { productName: 'DDGS', quantity: 0, unit: 'MT', rate: 0, gstPercent: 5 }])}
                className="text-blue-600 text-xs font-medium flex items-center gap-1 hover:text-blue-700">
                <Plus size={14} /> Add another product
              </button>

              {/* Logistics */}
              <div className="flex items-center gap-4 text-sm">
                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Freight:</span>
                <label className="flex items-center gap-1.5">
                  <input type="radio" value="BUYER" checked={logisticsBy === 'BUYER'} onChange={e => setLogisticsBy(e.target.value)} className="w-3.5 h-3.5" />
                  <span className="text-xs">Buyer arranges</span>
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" value="SELLER" checked={logisticsBy === 'SELLER'} onChange={e => setLogisticsBy(e.target.value)} className="w-3.5 h-3.5" />
                  <span className="text-xs">We arrange</span>
                </label>
                {logisticsBy === 'SELLER' && (
                  <input type="number" value={freightRate} onChange={e => setFreightRate(e.target.value)}
                    placeholder="/MT" className="border border-slate-300 px-2.5 py-1.5 text-xs w-24 focus:outline-none focus:ring-1 focus:ring-slate-400" />
                )}
              </div>

              {/* Summary + Save */}
              <div className="flex items-center justify-between bg-slate-100 p-3 border border-slate-300">
                <div className="text-xs space-y-0.5">
                  <div className="text-slate-600">
                    Subtotal {totals.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    {' + GST '}{totals.totalGst.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">
                    Total: {totals.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </div>
                </div>
                <button onClick={createOrder} disabled={saving}
                  className="px-6 py-2.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                  Create & Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex gap-1 overflow-x-auto">
          {['ALL', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap transition ${
                filterStatus === s ? 'border-b-2 border-blue-600 text-blue-700 bg-white' : 'text-slate-500 hover:text-slate-700'
              }`}>
              {s === 'ALL' ? 'All' : s === 'IN_PROGRESS' ? 'In Progress' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* Orders Table */}
        {loading ? (
          <div className="text-center py-12">
            <Loader2 size={24} className="animate-spin mx-auto mb-2 text-slate-400" />
            <p className="text-xs text-slate-400 uppercase tracking-widest">Loading orders...</p>
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-xs text-slate-400 uppercase tracking-widest">No orders found</p>
          </div>
        ) : (
          <div className="-mx-3 md:-mx-6 border-x border-slate-300">
            <table className="w-full">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Order #</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Customer</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700 hidden md:table-cell">Product</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700 hidden md:table-cell">Date</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center border-r border-slate-700">Status</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Total</th>
                  <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center w-8"></th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map(order => {
                  const line = order.lineItems?.[0] || (order as any).lines?.[0];
                  const pipe = getPipeline(order);
                  const isExpanded = expandedId === order.id;
                  const soConfirmed = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(order.status);

                  return (
                    <>
                      <tr key={order.id}
                        className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60 cursor-pointer"
                        onClick={() => setExpandedId(isExpanded ? null : order.id)}>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-bold text-slate-900">#{order.orderNo}</td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                          <div className="font-medium text-slate-700">{order.customerName}</div>
                          <div className="md:hidden text-[10px] text-slate-400">{line?.productName} {line?.quantity} {line?.unit}</div>
                        </td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 hidden md:table-cell text-slate-600">
                          {line?.productName} - {line?.quantity} {line?.unit} @ {(line?.rate || 0).toLocaleString('en-IN')}
                        </td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 hidden md:table-cell text-slate-500">
                          {new Date(order.orderDate).toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-center">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${getStatusBadge(order.status)}`}>{order.status}</span>
                        </td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums font-bold text-slate-800">
                          {(order.grandTotal || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </td>
                        <td className="px-3 py-1.5 text-xs text-center">
                          <ChevronDown size={14} className={`inline text-slate-400 transition ${isExpanded ? 'rotate-180' : ''}`} />
                        </td>
                      </tr>

                      {/* Dispatch Progress Row */}
                      {soConfirmed && order.status !== 'CANCELLED' && !isExpanded && (
                        <tr key={order.id + '_prog'}>
                          <td colSpan={7} className="px-3 py-0.5 border-b border-slate-100">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-slate-200 overflow-hidden">
                                <div className={`h-full transition-all duration-500 ${
                                  pipe.latestInvoice?.status === 'PAID' ? 'bg-green-500' :
                                  pipe.hasInvoice ? 'bg-blue-500' :
                                  pipe.dispatchPct > 0 ? 'bg-amber-500' :
                                  pipe.shipments.length > 0 ? 'bg-amber-400' :
                                  pipe.hasDR ? 'bg-blue-300' : 'bg-slate-300'
                                }`} style={{ width: `${Math.max(pipe.dispatchPct, pipe.hasDR ? 10 : 0, pipe.shipments.length > 0 ? 25 : 0, pipe.hasInvoice ? 85 : 0, pipe.latestInvoice?.status === 'PAID' ? 100 : 0)}%` }} />
                              </div>
                              <span className="text-[10px] text-slate-400 whitespace-nowrap">
                                {pipe.dispatchedMT > 0
                                  ? `${pipe.dispatchedMT.toFixed(1)}/${pipe.orderedQty} ${line?.unit || 'MT'}`
                                  : pipe.shipments.length > 0
                                  ? `${pipe.shipments.length} truck${pipe.shipments.length > 1 ? 's' : ''}`
                                  : pipe.hasDR ? 'Scheduled' : 'Pending'}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}

                      {/* Expanded Details */}
                      {isExpanded && (
                        <tr key={order.id + '_exp'}>
                          <td colSpan={7} className="bg-slate-50 px-4 py-3 border-b border-slate-200">
                            {/* Details grid */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Delivery</div>
                                <span className="font-medium">{new Date(order.deliveryDate).toLocaleDateString('en-IN')}</span>
                              </div>
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Payment</div>
                                <span className="font-medium">{order.paymentTerms}</span>
                              </div>
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Logistics</div>
                                <span className="font-medium">{order.logisticsBy}</span>
                              </div>
                              {order.freightRate ? <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Freight Rate</div>
                                <span className="font-medium font-mono tabular-nums">{order.freightRate}/MT</span>
                              </div> : null}
                            </div>

                            {/* Amounts */}
                            <div className="bg-white border border-slate-200 p-2 text-xs mb-3">
                              <div className="flex justify-between mb-0.5"><span className="text-slate-500">Amount</span><span className="font-mono tabular-nums">{(order.totalAmount || 0).toLocaleString('en-IN')}</span></div>
                              <div className="flex justify-between mb-0.5"><span className="text-slate-500">GST</span><span className="font-mono tabular-nums">{(order.totalGst || 0).toLocaleString('en-IN')}</span></div>
                              <div className="flex justify-between font-bold text-sm border-t pt-1"><span>Total</span><span className="font-mono tabular-nums">{(order.grandTotal || 0).toLocaleString('en-IN')}</span></div>
                            </div>

                            {/* Pipeline Details */}
                            {pipe.hasDR && (
                              <div className="text-xs space-y-1 mb-3">
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1"><Truck size={11} /> Dispatch Requests</div>
                                {(order.dispatchRequests || []).map((dr: any) => (
                                  <div key={dr.id} className="bg-white border border-slate-200 px-3 py-2 flex items-center justify-between">
                                    <span>DR #{dr.drNo} - {dr.quantity} {line?.unit || 'MT'}</span>
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                      dr.status === 'DISPATCHED' || dr.status === 'COMPLETED' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-blue-50 text-blue-700 border-blue-200'
                                    }`}>{dr.status}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {pipe.shipments.length > 0 && (
                              <div className="text-xs space-y-1 mb-3">
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Shipments</div>
                                {pipe.shipments.map((s: any) => (
                                  <div key={s.id} className="bg-white border border-slate-200 px-3 py-2 flex items-center justify-between">
                                    <span>{s.vehicleNo} - {s.weightNet ? `${(s.weightNet/1000).toFixed(2)} MT` : 'Weighing pending'}</span>
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                      ['RELEASED', 'EXITED'].includes(s.status) ? 'bg-green-50 text-green-700 border-green-200' : 'bg-amber-50 text-amber-700 border-amber-200'
                                    }`}>{s.status}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {pipe.hasInvoice && (
                              <div className="text-xs space-y-1 mb-3">
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1"><FileText size={11} /> Invoices</div>
                                {(order.invoices || []).map((inv: any) => (
                                  <div key={inv.id} className="bg-white border border-slate-200 px-3 py-2 flex items-center justify-between">
                                    <span>INV #{inv.invoiceNo} - <span className="font-mono tabular-nums">{inv.totalAmount?.toLocaleString('en-IN')}</span></span>
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                      inv.status === 'PAID' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
                                    }`}>{inv.status}</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Action Buttons */}
                            <div className="flex gap-2 flex-wrap pt-2 border-t border-slate-200">
                              {pipe.shipmentDone && !pipe.hasInvoice && (
                                <button onClick={() => createInvoice(order, pipe.latestShipment)} disabled={!!actionLoading}
                                  className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 flex items-center gap-1.5 disabled:opacity-50">
                                  {actionLoading === order.id + '_inv' ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />}
                                  Create Invoice
                                </button>
                              )}
                              {pipe.hasInvoice && (
                                <button onClick={() => {
                                    const token = localStorage.getItem('token');
                                    window.open(`/api/invoices/${pipe.latestInvoice!.id}/pdf?token=${token}`, '_blank');
                                }}
                                  className="px-3 py-1 text-[11px] font-medium text-green-700 border border-green-300 hover:bg-green-50 flex items-center gap-1">
                                  <FileText size={12} /> Print Invoice
                                </button>
                              )}
                              {['CONFIRMED', 'DRAFT'].includes(order.status) && !pipe.hasDR && (
                                <button onClick={() => cancelOrder(order)} disabled={!!actionLoading}
                                  className="px-3 py-1 text-[11px] font-medium text-red-600 border border-red-200 hover:bg-red-50 flex items-center gap-1">
                                  <X size={12} /> Cancel
                                </button>
                              )}
                              {['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(order.status) && (
                                <button onClick={() => deleteOrder(order)} disabled={!!actionLoading}
                                  className="px-3 py-1 text-[11px] font-medium text-red-600 border border-red-200 hover:bg-red-50 flex items-center gap-1">
                                  <Trash2 size={12} /> Delete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
