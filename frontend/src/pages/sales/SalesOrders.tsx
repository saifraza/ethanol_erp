import { useState, useEffect } from 'react';
import { ClipboardList, Plus, X, Save, Loader2, Trash2, ChevronDown, Truck, FileText, Send, CheckCircle, Clock, ArrowRight } from 'lucide-react';
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
      // For each order, normalize lineItems
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

  // ── Calculations ──
  const calcTotals = (items: LineItem[]) => {
    let amt = 0, gst = 0;
    items.forEach(i => { const a = i.quantity * i.rate; amt += a; gst += a * (i.gstPercent / 100); });
    return { totalAmount: amt, totalGst: gst, grandTotal: amt + gst };
  };
  const totals = calcTotals(lineItems);

  // ── Form Actions ──
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
      // Create SO — backend creates as DRAFT, we immediately confirm
      const res = await api.post('/sales-orders', {
        customerId, orderDate: new Date().toISOString().split('T')[0], deliveryDate,
        paymentTerms, logisticsBy,
        freightRate: logisticsBy === 'SELLER' ? parseFloat(freightRate) : undefined,
        lineItems: lineItems.filter(i => i.quantity > 0), remarks,
      });
      const soId = res.data.id;
      // Auto-confirm
      await api.put(`/sales-orders/${soId}/status`, { status: 'CONFIRMED' });
      flash('ok', `Order #${res.data.orderNo} created & confirmed`);
      resetForm();
      loadAll();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed to create order');
    } finally {
      setSaving(false);
    }
  };

  // ── Order Actions ──
  const sendToFactory = async (order: SalesOrder) => {
    setActionLoading(order.id + '_send');
    try {
      const line = order.lineItems?.[0] || order.lines?.[0];
      await api.post('/dispatch-requests', {
        orderId: order.id,
        customerId: order.customerId,
        productName: line?.productName || 'DDGS',
        quantity: line?.quantity || 0,
        unit: line?.unit || 'MT',
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

  // ── Pipeline Status ──
  const getPipeline = (order: SalesOrder) => {
    const drs = order.dispatchRequests || [];
    const hasDR = drs.length > 0;
    const latestDR = drs[drs.length - 1];

    // Get shipments from dispatchRequests or order level
    let shipments: any[] = [];
    drs.forEach((dr: any) => {
      if (dr.shipments) shipments.push(...dr.shipments);
    });
    if (order.shipments) shipments.push(...order.shipments);
    const latestShipment = shipments[shipments.length - 1];
    const shipmentDone = latestShipment && ['RELEASED', 'EXITED'].includes(latestShipment.status);

    const invoices = order.invoices || [];
    const hasInvoice = invoices.length > 0;
    const latestInvoice = invoices[invoices.length - 1];

    return { hasDR, latestDR, shipments, latestShipment, shipmentDone, hasInvoice, latestInvoice };
  };

  const getStepColor = (done: boolean, active: boolean) =>
    done ? 'bg-green-500 text-white' : active ? 'bg-blue-500 text-white animate-pulse' : 'bg-gray-200 text-gray-500';

  const filteredOrders = orders.filter(o =>
    filterStatus === 'ALL' || o.status === filterStatus
  ).sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

  const stats = {
    total: orders.length,
    active: orders.filter(o => ['CONFIRMED', 'IN_PROGRESS'].includes(o.status)).length,
    value: orders.filter(o => !['CANCELLED'].includes(o.status)).reduce((s, o) => s + (o.grandTotal || 0), 0),
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white">
        <div className="max-w-6xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <ClipboardList size={28} /> Sales Orders
              </h1>
              <div className="flex gap-4 mt-2 text-sm text-purple-200">
                <span>{stats.total} orders</span>
                <span>{stats.active} active</span>
                <span>₹{stats.value.toLocaleString('en-IN', { maximumFractionDigits: 0 })} value</span>
              </div>
            </div>
            {!showForm && (
              <button onClick={() => setShowForm(true)}
                className="bg-white text-purple-700 px-4 py-2 rounded-lg font-semibold text-sm hover:bg-purple-50 flex items-center gap-2 shadow">
                <Plus size={16} /> New Sale
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm flex items-center gap-2 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.type === 'ok' ? <CheckCircle size={16} /> : <X size={16} />}
            {msg.text}
          </div>
        )}

        {/* ── Quick Create Form ── */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-lg border border-purple-200 mb-6 overflow-hidden">
            <div className="bg-purple-50 px-4 py-3 flex items-center justify-between border-b border-purple-200">
              <h3 className="font-bold text-purple-800 text-sm">Quick Sale Order</h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>

            <div className="p-4 space-y-4">
              {/* Row 1: Customer + Payment */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Customer *</label>
                  <select value={customerId} onChange={e => setCustomerId(e.target.value)}
                    className="input-field w-full text-sm mt-1">
                    <option value="">Select Party</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Delivery By</label>
                  <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
                    className="input-field w-full text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Payment</label>
                  <select value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}
                    className="input-field w-full text-sm mt-1">
                    <option value="ADVANCE">Advance</option>
                    <option value="COD">COD</option>
                    <option value="NET7">7 Days</option>
                    <option value="NET15">15 Days</option>
                    <option value="NET30">30 Days</option>
                  </select>
                </div>
              </div>

              {/* Line Items — compact */}
              {lineItems.map((item, idx) => (
                <div key={idx} className="bg-gray-50 rounded-lg p-3 border">
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
                    <div>
                      <label className="text-[10px] text-gray-500">Product</label>
                      <select value={item.productName} onChange={e => handleProductChange(idx, e.target.value)}
                        className="input-field w-full text-xs">
                        <option value="DDGS">DDGS</option>
                        <option value="ETHANOL">Ethanol</option>
                        <option value="LFO">LFO</option>
                        <option value="HFO">HFO</option>
                        <option value="RS">RS</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Qty</label>
                      <input type="number" value={item.quantity || ''} placeholder="300"
                        onChange={e => { const u = [...lineItems]; u[idx] = { ...u[idx], quantity: parseFloat(e.target.value) || 0 }; setLineItems(u); }}
                        className="input-field w-full text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Unit</label>
                      <select value={item.unit} onChange={e => { const u = [...lineItems]; u[idx] = { ...u[idx], unit: e.target.value }; setLineItems(u); }}
                        className="input-field w-full text-xs">
                        <option value="MT">MT</option>
                        <option value="KL">KL</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Rate (₹/unit)</label>
                      <input type="number" value={item.rate || ''} placeholder="18000"
                        onChange={e => { const u = [...lineItems]; u[idx] = { ...u[idx], rate: parseFloat(e.target.value) || 0 }; setLineItems(u); }}
                        className="input-field w-full text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">GST %</label>
                      <input type="number" value={item.gstPercent}
                        onChange={e => { const u = [...lineItems]; u[idx] = { ...u[idx], gstPercent: parseFloat(e.target.value) || 0 }; setLineItems(u); }}
                        className="input-field w-full text-xs" />
                    </div>
                    <div className="flex items-end gap-1">
                      <div className="flex-1 text-right">
                        <label className="text-[10px] text-gray-500">Amount</label>
                        <div className="text-sm font-bold text-purple-700">
                          ₹{(item.quantity * item.rate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
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
                className="text-purple-600 text-xs font-medium flex items-center gap-1 hover:text-purple-700">
                <Plus size={14} /> Add another product
              </button>

              {/* Logistics */}
              <div className="flex items-center gap-4 text-sm">
                <span className="text-gray-500 text-xs font-medium">Freight:</span>
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
                    placeholder="₹/MT" className="input-field w-24 text-xs" />
                )}
              </div>

              {/* Summary + Save */}
              <div className="flex items-center justify-between bg-purple-50 rounded-lg p-3 border border-purple-200">
                <div className="text-sm space-y-0.5">
                  <div className="text-gray-600">
                    Subtotal ₹{totals.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    {' + GST ₹'}{totals.totalGst.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </div>
                  <div className="text-lg font-bold text-purple-700">
                    Total: ₹{totals.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                  </div>
                </div>
                <button onClick={createOrder} disabled={saving}
                  className="px-6 py-3 bg-purple-600 text-white rounded-lg font-bold text-sm hover:bg-purple-700 disabled:opacity-50 flex items-center gap-2 shadow-lg">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                  Create & Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Filters ── */}
        <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
          {['ALL', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(s => (
            <button key={s} onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition ${
                filterStatus === s ? 'bg-purple-600 text-white' : 'bg-white text-gray-600 border hover:bg-gray-50'
              }`}>
              {s === 'ALL' ? 'All' : s === 'IN_PROGRESS' ? 'In Progress' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>

        {/* ── Orders ── */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-12">
            <ClipboardList size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">No orders found</p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredOrders.map(order => {
              const line = order.lineItems?.[0] || (order as any).lines?.[0];
              const pipe = getPipeline(order);
              const isExpanded = expandedId === order.id;
              const soConfirmed = ['CONFIRMED', 'IN_PROGRESS', 'COMPLETED'].includes(order.status);

              return (
                <div key={order.id} className="bg-white rounded-lg border shadow-sm hover:shadow-md transition">
                  {/* Card Header */}
                  <button onClick={() => setExpandedId(isExpanded ? null : order.id)}
                    className="w-full p-4 text-left">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="font-bold text-gray-900">#{order.orderNo}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            order.status === 'CONFIRMED' ? 'bg-blue-100 text-blue-700' :
                            order.status === 'IN_PROGRESS' ? 'bg-amber-100 text-amber-700' :
                            order.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                            order.status === 'CANCELLED' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>{order.status}</span>
                        </div>
                        <p className="text-sm text-gray-700 font-medium">{order.customerName}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {line?.productName} · {line?.quantity} {line?.unit} @ ₹{(line?.rate || 0).toLocaleString('en-IN')}
                          {' · '}{new Date(order.orderDate).toLocaleDateString('en-IN')}
                        </p>
                      </div>
                      <div className="text-right ml-4 shrink-0">
                        <div className="text-lg font-bold text-purple-700">
                          ₹{(order.grandTotal || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </div>
                        <ChevronDown size={16} className={`text-gray-400 ml-auto transition ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>

                    {/* Pipeline Mini-tracker */}
                    {soConfirmed && order.status !== 'CANCELLED' && (
                      <div className="flex items-center gap-1 mt-3">
                        <div className={`h-1.5 flex-1 rounded-full bg-green-500`} />
                        <div className={`h-1.5 flex-1 rounded-full ${pipe.hasDR ? 'bg-green-500' : 'bg-gray-200'}`} />
                        <div className={`h-1.5 flex-1 rounded-full ${pipe.shipmentDone ? 'bg-green-500' : pipe.latestShipment ? 'bg-blue-400' : 'bg-gray-200'}`} />
                        <div className={`h-1.5 flex-1 rounded-full ${pipe.hasInvoice ? 'bg-green-500' : 'bg-gray-200'}`} />
                        <div className={`h-1.5 flex-1 rounded-full ${pipe.latestInvoice?.status === 'PAID' ? 'bg-green-500' : 'bg-gray-200'}`} />
                        <div className="text-[9px] text-gray-400 ml-1 whitespace-nowrap">
                          {!pipe.hasDR ? 'Send to logistics' :
                           !pipe.latestShipment ? 'Trucks scheduled' :
                           !pipe.shipmentDone ? `Truck: ${pipe.latestShipment.status}` :
                           !pipe.hasInvoice ? 'Ready to invoice' :
                           pipe.latestInvoice?.status === 'PAID' ? 'Complete' :
                           'Payment pending'}
                        </div>
                      </div>
                    )}
                  </button>

                  {/* ── Expanded ── */}
                  {isExpanded && (
                    <div className="border-t bg-gray-50 p-4 space-y-3">
                      {/* Details grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                        <div><span className="text-gray-500">Delivery</span><br/><span className="font-medium">{new Date(order.deliveryDate).toLocaleDateString('en-IN')}</span></div>
                        <div><span className="text-gray-500">Payment</span><br/><span className="font-medium">{order.paymentTerms}</span></div>
                        <div><span className="text-gray-500">Logistics</span><br/><span className="font-medium">{order.logisticsBy}</span></div>
                        {order.freightRate ? <div><span className="text-gray-500">Freight Rate</span><br/><span className="font-medium">₹{order.freightRate}/MT</span></div> : null}
                      </div>

                      {/* Amounts */}
                      <div className="bg-white rounded border p-2 text-xs">
                        <div className="flex justify-between mb-0.5"><span className="text-gray-500">Amount</span><span>₹{(order.totalAmount || 0).toLocaleString('en-IN')}</span></div>
                        <div className="flex justify-between mb-0.5"><span className="text-gray-500">GST</span><span>₹{(order.totalGst || 0).toLocaleString('en-IN')}</span></div>
                        <div className="flex justify-between font-bold text-sm border-t pt-1"><span>Total</span><span className="text-purple-700">₹{(order.grandTotal || 0).toLocaleString('en-IN')}</span></div>
                      </div>

                      {/* Pipeline Details */}
                      {pipe.hasDR && (
                        <div className="text-xs space-y-1">
                          <div className="font-semibold text-gray-600 flex items-center gap-1"><Truck size={12} /> Dispatch</div>
                          {(order.dispatchRequests || []).map((dr: any) => (
                            <div key={dr.id} className="bg-white rounded border px-3 py-2 flex items-center justify-between">
                              <span>DR #{dr.drNo} · {dr.quantity} {line?.unit || 'MT'}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                dr.status === 'DISPATCHED' || dr.status === 'COMPLETED' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
                              }`}>{dr.status}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {pipe.shipments.length > 0 && (
                        <div className="text-xs space-y-1">
                          <div className="font-semibold text-gray-600">Shipments</div>
                          {pipe.shipments.map((s: any) => (
                            <div key={s.id} className="bg-white rounded border px-3 py-2 flex items-center justify-between">
                              <span>{s.vehicleNo} · {s.weightNet ? `${(s.weightNet/1000).toFixed(2)} MT` : 'Weighing pending'}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                ['RELEASED', 'EXITED'].includes(s.status) ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                              }`}>{s.status}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {pipe.hasInvoice && (
                        <div className="text-xs space-y-1">
                          <div className="font-semibold text-gray-600 flex items-center gap-1"><FileText size={12} /> Invoices</div>
                          {(order.invoices || []).map((inv: any) => (
                            <div key={inv.id} className="bg-white rounded border px-3 py-2 flex items-center justify-between">
                              <span>INV #{inv.invoiceNo} · ₹{inv.totalAmount?.toLocaleString('en-IN')}</span>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${
                                inv.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}>{inv.status}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* ── Action Buttons ── */}
                      <div className="flex gap-2 flex-wrap pt-2 border-t">
                        {/* Send to Factory */}
                        {soConfirmed && !pipe.hasDR && order.status !== 'CANCELLED' && (
                          <button onClick={() => sendToFactory(order)} disabled={!!actionLoading}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50">
                            {actionLoading === order.id + '_send' ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            Send to Logistics
                          </button>
                        )}

                        {/* Create Invoice from completed shipment */}
                        {pipe.shipmentDone && !pipe.hasInvoice && (
                          <button onClick={() => createInvoice(order, pipe.latestShipment)} disabled={!!actionLoading}
                            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 flex items-center gap-2 disabled:opacity-50">
                            {actionLoading === order.id + '_inv' ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                            Create Invoice
                          </button>
                        )}

                        {/* Print Invoice PDF */}
                        {pipe.hasInvoice && (
                          <button onClick={async () => {
                            try {
                              const resp = await api.get(`/invoices/${pipe.latestInvoice!.id}/pdf`, { responseType: 'blob' });
                              window.open(window.URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' })), '_blank');
                            } catch { flash('err', 'PDF failed'); }
                          }}
                            className="px-3 py-2 bg-white text-green-700 text-sm font-medium rounded-lg border border-green-300 hover:bg-green-50 flex items-center gap-1">
                            <FileText size={14} /> Print Invoice
                          </button>
                        )}

                        {/* Cancel */}
                        {['CONFIRMED', 'DRAFT'].includes(order.status) && !pipe.hasDR && (
                          <button onClick={() => cancelOrder(order)} disabled={!!actionLoading}
                            className="px-3 py-2 text-red-600 text-sm font-medium rounded-lg border border-red-200 hover:bg-red-50 flex items-center gap-1">
                            <X size={14} /> Cancel
                          </button>
                        )}

                        {/* Delete */}
                        {['DRAFT', 'CONFIRMED', 'CANCELLED'].includes(order.status) && (
                          <button onClick={() => deleteOrder(order)} disabled={!!actionLoading}
                            className="px-3 py-2 text-red-600 text-sm font-medium rounded-lg border border-red-200 hover:bg-red-50 flex items-center gap-1">
                            <Trash2 size={14} /> Delete
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
