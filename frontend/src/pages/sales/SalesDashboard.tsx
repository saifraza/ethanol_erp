import { useState, useEffect } from 'react';
import {
  ClipboardList, Plus, X, Loader2, Trash2, ChevronDown, ChevronRight,
  Truck, FileText, CheckCircle, Clock, Package, Scale, Receipt,
  IndianRupee, Share2, Phone, AlertCircle, RotateCcw
} from 'lucide-react';
import api from '../../services/api';

// ── Types ──
interface Customer { id: string; name: string; }
interface Product { id: string; name: string; defaultRate: number; gstPercent: number; unit: string; }
interface LineItem {
  productName: string; productId?: string; quantity: number; unit: string; rate: number; gstPercent: number;
}
interface Shipment {
  id: string; vehicleNo: string; status: string; driverName?: string; driverMobile?: string;
  weightTare?: number; weightGross?: number; weightNet?: number;
  transporterName?: string; challanNo?: string; ewayBill?: string; gatePassNo?: string;
  gateInTime?: string; capacityTon?: number;
}
interface DR {
  id: string; drNo: number; status: string; quantity: number; unit?: string;
  shipments?: Shipment[];
}
interface Invoice { id: string; invoiceNo: number; status: string; totalAmount: number; }
interface SalesOrder {
  id: string; orderNo: string; customerId: string; customerName: string;
  orderDate: string; deliveryDate: string; paymentTerms: string; logisticsBy: string;
  freightRate?: number; lineItems: LineItem[]; lines?: LineItem[];
  remarks?: string; status: string; grandTotal?: number; totalGst?: number; totalAmount?: number;
  dispatchRequests?: DR[]; shipments?: any[]; invoices?: Invoice[];
}

// ── Phase helpers ──
type Phase = 'ORDER' | 'LOGISTICS' | 'WEIGHBRIDGE' | 'LOADING' | 'INVOICED' | 'PAID' | 'CANCELLED';

// Static color maps (Tailwind can't purge dynamic classes)
const PHASE_COLORS: Record<string, { badge: string; bar: string; barActive: string; text: string; nextText: string }> = {
  ORDER:       { badge: 'bg-purple-100 text-purple-700', bar: 'bg-purple-500', barActive: 'bg-purple-500', text: 'text-purple-600', nextText: 'text-purple-600' },
  LOGISTICS:   { badge: 'bg-orange-100 text-orange-700', bar: 'bg-orange-500', barActive: 'bg-orange-500', text: 'text-orange-600', nextText: 'text-orange-600' },
  WEIGHBRIDGE: { badge: 'bg-amber-100 text-amber-700', bar: 'bg-amber-500', barActive: 'bg-amber-500', text: 'text-amber-600', nextText: 'text-amber-600' },
  LOADING:     { badge: 'bg-green-100 text-green-700', bar: 'bg-green-500', barActive: 'bg-green-500', text: 'text-green-600', nextText: 'text-green-600' },
  INVOICED:    { badge: 'bg-blue-100 text-blue-700', bar: 'bg-blue-500', barActive: 'bg-blue-500', text: 'text-blue-600', nextText: 'text-blue-600' },
  PAID:        { badge: 'bg-emerald-100 text-emerald-700', bar: 'bg-emerald-500', barActive: 'bg-emerald-500', text: 'text-emerald-600', nextText: 'text-emerald-600' },
  CANCELLED:   { badge: 'bg-red-100 text-red-700', bar: 'bg-red-500', barActive: 'bg-red-500', text: 'text-red-600', nextText: 'text-red-600' },
};

function getPhase(order: SalesOrder): { phase: Phase; label: string; nextAction: string; pct: number } {
  if (order.status === 'CANCELLED') return { phase: 'CANCELLED', label: 'Cancelled', nextAction: '', pct: 0 };

  const drs = order.dispatchRequests || [];
  const invoices = order.invoices || [];
  const hasPaid = invoices.some(i => i.status === 'PAID');
  const hasInvoice = invoices.length > 0;

  let shipments: Shipment[] = [];
  drs.forEach(dr => { if (dr.shipments) shipments.push(...dr.shipments); });

  const hasCompletedShipment = shipments.some(s => ['RELEASED', 'EXITED'].includes(s.status));
  const hasActiveShipment = shipments.some(s => !['RELEASED', 'EXITED', 'CANCELLED'].includes(s.status));
  const hasDR = drs.some(d => !['CANCELLED'].includes(d.status));

  if (hasPaid) return { phase: 'PAID', label: 'Paid', nextAction: '', pct: 100 };
  if (hasInvoice) return { phase: 'INVOICED', label: 'Invoiced', nextAction: 'Record payment', pct: 85 };
  if (hasCompletedShipment) return { phase: 'LOADING', label: 'Dispatched', nextAction: 'Create invoice', pct: 70 };
  if (hasActiveShipment) return { phase: 'WEIGHBRIDGE', label: 'At Weighbridge', nextAction: 'Complete weighbridge', pct: 45 };
  if (hasDR) return { phase: 'LOGISTICS', label: 'In Logistics', nextAction: 'Assign truck', pct: 25 };
  return { phase: 'ORDER', label: 'New Order', nextAction: 'Send to logistics', pct: 10 };
}

const PHASE_STEPS = [
  { key: 'ORDER', icon: ClipboardList, label: 'Order' },
  { key: 'LOGISTICS', icon: Truck, label: 'Logistics' },
  { key: 'WEIGHBRIDGE', icon: Scale, label: 'Weighbridge' },
  { key: 'LOADING', icon: Package, label: 'Dispatch' },
  { key: 'INVOICED', icon: Receipt, label: 'Invoice' },
  { key: 'PAID', icon: IndianRupee, label: 'Paid' },
];
const PHASE_ORDER = PHASE_STEPS.map(s => s.key);

export default function SalesDashboard() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [filterPhase, setFilterPhase] = useState('ALL');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Form state
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

  // Truck form (inline)
  const [truckFormDR, setTruckFormDR] = useState<string | null>(null);
  const [truckVehicle, setTruckVehicle] = useState('');
  const [truckDriver, setTruckDriver] = useState('');
  const [truckMobile, setTruckMobile] = useState('');
  const [truckTransporter, setTruckTransporter] = useState('');

  // Weighbridge form (inline)
  const [weighFormShipment, setWeighFormShipment] = useState<string | null>(null);
  const [weighValue, setWeighValue] = useState('');
  const [weighType, setWeighType] = useState<'tare' | 'gross'>('tare');

  // Release form
  const [releaseFormShipment, setReleaseFormShipment] = useState<string | null>(null);
  const [releaseChallan, setReleaseChallan] = useState('');
  const [releaseEway, setReleaseEway] = useState('');

  const loadAll = async () => {
    try {
      setLoading(true);
      const [ordRes, custRes, prodRes] = await Promise.all([
        api.get('/sales-orders'),
        api.get('/customers'),
        api.get('/products'),
      ]);
      const rawOrders = ordRes.data.orders || ordRes.data || [];
      setOrders(rawOrders.map((o: any) => ({
        ...o,
        customerName: o.customerName || o.customer?.name || '',
        lineItems: o.lineItems || o.lines || [],
      })));
      setCustomers(custRes.data.customers || custRes.data || []);
      setProducts(prodRes.data.products || prodRes.data || []);
    } catch {
      flash('err', 'Failed to load data');
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

  // ── Create Order ──
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
      ...updated[idx], productName,
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
      // Auto-confirm
      await api.put(`/sales-orders/${soId}/status`, { status: 'CONFIRMED' });
      // Auto-create dispatch request
      const line = validLines[0];
      await api.post('/dispatch-requests', {
        orderId: soId, customerId,
        productName: line?.productName || 'DDGS',
        quantity: line?.quantity || 0,
        unit: line?.unit || 'MT',
        logisticsBy, deliveryDate,
        remarks: remarks || '',
      });
      flash('ok', `Order #${orderNo} created & sent to logistics`);
      resetForm();
      loadAll();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed to create order');
    } finally {
      setSaving(false);
    }
  };

  // ── Actions ──
  const deleteOrder = async (order: SalesOrder) => {
    if (!confirm(`Delete order #${order.orderNo}?`)) return;
    setActionLoading(order.id);
    try {
      // Delete related DRs first
      const drs = order.dispatchRequests || [];
      for (const dr of drs) {
        try { await api.delete(`/dispatch-requests/${dr.id}`); } catch {}
      }
      await api.delete(`/sales-orders/${order.id}`);
      flash('ok', `Order #${order.orderNo} deleted`);
      loadAll();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed to delete');
    } finally {
      setActionLoading(null);
    }
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) { flash('err', 'Select orders first'); return; }
    if (!confirm(`Delete ${selectedIds.size} selected orders?`)) return;
    setActionLoading('bulk');
    let deleted = 0;
    for (const id of selectedIds) {
      try {
        const order = orders.find(o => o.id === id);
        if (order) {
          for (const dr of (order.dispatchRequests || [])) {
            try { await api.delete(`/dispatch-requests/${dr.id}`); } catch {}
          }
        }
        await api.delete(`/sales-orders/${id}`);
        deleted++;
      } catch {}
    }
    flash('ok', `Deleted ${deleted} orders`);
    setSelectedIds(new Set());
    loadAll();
    setActionLoading(null);
  };

  const assignTruck = async (drId: string) => {
    if (!truckVehicle.trim()) { flash('err', 'Enter vehicle number'); return; }
    setActionLoading(drId);
    try {
      const dr = orders.flatMap(o => o.dispatchRequests || []).find(d => d.id === drId);
      await api.post('/shipments', {
        dispatchRequestId: drId,
        vehicleNo: truckVehicle.trim().toUpperCase(),
        driverName: truckDriver || null,
        driverMobile: truckMobile || null,
        transporterName: truckTransporter || null,
        gateInTime: new Date().toISOString(),
        productName: dr?.quantity ? 'DDGS' : '',
        customerName: '',
      });
      flash('ok', `Truck ${truckVehicle} assigned`);
      setTruckFormDR(null); setTruckVehicle(''); setTruckDriver(''); setTruckMobile(''); setTruckTransporter('');
      loadAll();
    } catch (e: any) {
      flash('err', e.response?.data?.error || 'Failed');
    } finally {
      setActionLoading(null);
    }
  };

  const recordWeigh = async (shipmentId: string) => {
    if (!weighValue) { flash('err', 'Enter weight'); return; }
    setActionLoading(shipmentId);
    try {
      const w = parseFloat(weighValue);
      const body = weighType === 'tare'
        ? { weightTare: w, tareTime: new Date().toISOString() }
        : { weightGross: w, grossTime: new Date().toISOString() };
      await api.put(`/shipments/${shipmentId}/weighbridge`, body);
      flash('ok', `${weighType === 'tare' ? 'Tare' : 'Gross'} weight recorded`);
      setWeighFormShipment(null); setWeighValue('');
      loadAll();
    } catch { flash('err', 'Failed'); }
    finally { setActionLoading(null); }
  };

  const updateShipmentStatus = async (shipmentId: string, status: string, extra?: any) => {
    setActionLoading(shipmentId);
    try {
      await api.put(`/shipments/${shipmentId}/status`, { status, ...extra });
      flash('ok', `Updated to ${status.replace(/_/g, ' ')}`);
      if (status === 'RELEASED') { setReleaseFormShipment(null); setReleaseChallan(''); setReleaseEway(''); }
      loadAll();
    } catch { flash('err', 'Failed'); }
    finally { setActionLoading(null); }
  };

  const createInvoice = async (order: SalesOrder, shipment: Shipment) => {
    setActionLoading(order.id + '_inv');
    try {
      const line = order.lineItems?.[0] || (order as any).lines?.[0];
      const netTons = shipment.weightNet ? shipment.weightNet / 1000 : (line?.quantity || 0);
      await api.post('/invoices', {
        customerId: order.customerId, orderId: order.id, shipmentId: shipment.id,
        productName: line?.productName || 'DDGS', quantity: netTons, unit: line?.unit || 'MT',
        rate: line?.rate || 0, gstPercent: line?.gstPercent || 5,
        freightCharge: order.logisticsBy === 'SELLER' ? netTons * (order.freightRate || 0) : 0,
        invoiceDate: new Date().toISOString().split('T')[0],
      });
      flash('ok', 'Invoice created');
      loadAll();
    } catch (e: any) { flash('err', e.response?.data?.error || 'Failed'); }
    finally { setActionLoading(null); }
  };

  // ── Filter & Stats ──
  const orderPhases = orders.map(o => {
    const p = getPhase(o);
    return { order: o, ...p, colors: PHASE_COLORS[p.phase] || PHASE_COLORS.ORDER };
  });
  const filtered = orderPhases.filter(op =>
    filterPhase === 'ALL' || op.phase === filterPhase
  ).sort((a, b) => new Date(b.order.orderDate).getTime() - new Date(a.order.orderDate).getTime());

  const phaseCounts: Record<string, number> = { ALL: orders.length };
  orderPhases.forEach(op => { phaseCounts[op.phase] = (phaseCounts[op.phase] || 0) + 1; });

  const totalValue = orders.filter(o => o.status !== 'CANCELLED').reduce((s, o) => s + (o.grandTotal || 0), 0);

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelectedIds(next);
  };

  const selectAll = () => {
    if (selectedIds.size === filtered.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filtered.map(f => f.order.id)));
    }
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <div className="bg-gradient-to-r from-slate-800 to-slate-900 text-white">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <ClipboardList size={24} /> Sales Pipeline
              </h1>
              <div className="flex gap-4 mt-1 text-sm text-slate-300">
                <span>{orders.length} orders</span>
                <span>₹{totalValue.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selectedIds.size > 0 && (
                <button onClick={bulkDelete} disabled={actionLoading === 'bulk'}
                  className="bg-red-600 text-white px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-1 hover:bg-red-700">
                  {actionLoading === 'bulk' ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Delete {selectedIds.size}
                </button>
              )}
              {!showForm && (
                <button onClick={() => setShowForm(true)}
                  className="bg-white text-slate-800 px-4 py-2 rounded-lg font-semibold text-sm hover:bg-slate-100 flex items-center gap-2 shadow">
                  <Plus size={16} /> New Sale
                </button>
              )}
            </div>
          </div>

          {/* Phase summary chips */}
          <div className="flex gap-2 mt-3 overflow-x-auto pb-1">
            {[
              { key: 'ALL', label: 'All', bg: 'bg-white/20' },
              { key: 'ORDER', label: 'New', bg: 'bg-purple-500/30' },
              { key: 'LOGISTICS', label: 'Logistics', bg: 'bg-orange-500/30' },
              { key: 'WEIGHBRIDGE', label: 'Weighbridge', bg: 'bg-amber-500/30' },
              { key: 'LOADING', label: 'Dispatched', bg: 'bg-green-500/30' },
              { key: 'INVOICED', label: 'Invoiced', bg: 'bg-blue-500/30' },
              { key: 'PAID', label: 'Paid', bg: 'bg-emerald-500/30' },
            ].map(f => (
              <button key={f.key} onClick={() => setFilterPhase(f.key)}
                className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition ${
                  filterPhase === f.key ? 'bg-white text-slate-800 shadow' : `${f.bg} text-white/90 hover:bg-white/30`
                }`}>
                {f.label} {phaseCounts[f.key] ? `(${phaseCounts[f.key]})` : ''}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-4">
        {/* Flash message */}
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm flex items-center gap-2 ${
            msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'
          }`}>
            {msg.type === 'ok' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {msg.text}
          </div>
        )}

        {/* ── Create Form ── */}
        {showForm && (
          <div className="bg-white rounded-xl shadow-lg border mb-6 overflow-hidden">
            <div className="bg-slate-50 px-4 py-3 flex items-center justify-between border-b">
              <h3 className="font-bold text-slate-800 text-sm">New Sale Order</h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="p-4 space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Customer *</label>
                  <select value={customerId} onChange={e => setCustomerId(e.target.value)}
                    className="input-field w-full text-sm mt-1">
                    <option value="">Select</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Delivery Date</label>
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

              {lineItems.map((item, idx) => (
                <div key={idx} className="bg-gray-50 rounded-lg p-3 border">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
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
                      <label className="text-[10px] text-gray-500">Qty ({item.unit})</label>
                      <input type="number" value={item.quantity || ''} placeholder="300"
                        onChange={e => { const u = [...lineItems]; u[idx] = { ...u[idx], quantity: parseFloat(e.target.value) || 0 }; setLineItems(u); }}
                        className="input-field w-full text-xs" />
                    </div>
                    <div>
                      <label className="text-[10px] text-gray-500">Rate (₹)</label>
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
                    <div className="flex items-end">
                      <div className="text-sm font-bold text-slate-700">
                        ₹{(item.quantity * item.rate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                      </div>
                    </div>
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-4 text-sm">
                <span className="text-gray-500 text-xs font-medium">Transport:</span>
                <label className="flex items-center gap-1.5">
                  <input type="radio" value="BUYER" checked={logisticsBy === 'BUYER'} onChange={e => setLogisticsBy(e.target.value)} className="w-3.5 h-3.5" />
                  <span className="text-xs">Buyer arranges</span>
                </label>
                <label className="flex items-center gap-1.5">
                  <input type="radio" value="SELLER" checked={logisticsBy === 'SELLER'} onChange={e => setLogisticsBy(e.target.value)} className="w-3.5 h-3.5" />
                  <span className="text-xs">MSPIL arranges</span>
                </label>
                {logisticsBy === 'SELLER' && (
                  <span className="text-[10px] text-orange-600 font-medium">→ Logistics team will set rate</span>
                )}
              </div>

              <div className="flex items-center justify-between bg-slate-50 rounded-lg p-3 border">
                <div className="text-sm">
                  <span className="text-gray-600">₹{totals.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  <span className="text-gray-400"> + GST ₹{totals.totalGst.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  <span className="text-lg font-bold text-slate-800 ml-3">= ₹{totals.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                </div>
                <button onClick={createOrder} disabled={saving}
                  className="px-6 py-2.5 bg-slate-800 text-white rounded-lg font-bold text-sm hover:bg-slate-900 disabled:opacity-50 flex items-center gap-2">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle size={16} />}
                  Create & Send to Logistics
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Bulk actions bar ── */}
        {filtered.length > 0 && (
          <div className="flex items-center gap-2 mb-3">
            <label className="flex items-center gap-1.5 text-xs text-gray-500 cursor-pointer">
              <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0}
                onChange={selectAll} className="w-3.5 h-3.5 rounded" />
              Select all
            </label>
            {selectedIds.size > 0 && (
              <span className="text-xs text-gray-400">{selectedIds.size} selected</span>
            )}
          </div>
        )}

        {/* ── Orders List ── */}
        {loading ? (
          <div className="text-center py-12 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <ClipboardList size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500 text-sm">No orders found</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(({ order, phase, label, nextAction, pct, colors }) => {
              const line = order.lineItems?.[0] || (order as any).lines?.[0];
              const isExpanded = expandedId === order.id;
              const drs = order.dispatchRequests || [];
              const allShipments: Shipment[] = [];
              drs.forEach(dr => { if (dr.shipments) allShipments.push(...dr.shipments); });
              const invoices = order.invoices || [];
              const phaseIdx = PHASE_ORDER.indexOf(phase);

              return (
                <div key={order.id} className={`bg-white rounded-lg border shadow-sm transition ${
                  phase === 'CANCELLED' ? 'opacity-50' : 'hover:shadow-md'
                }`}>
                  {/* ── Card Row ── */}
                  <div className="flex items-center gap-3 p-3">
                    {/* Checkbox */}
                    <input type="checkbox" checked={selectedIds.has(order.id)}
                      onChange={() => toggleSelect(order.id)}
                      className="w-4 h-4 rounded shrink-0" />

                    {/* Main content - clickable */}
                    <button onClick={() => setExpandedId(isExpanded ? null : order.id)}
                      className="flex-1 text-left min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="font-bold text-sm text-gray-900">#{order.orderNo}</span>
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${colors.badge}`}>
                            {label}
                          </span>
                          <span className="text-sm text-gray-700 truncate">{order.customerName}</span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-sm font-bold text-gray-800">
                            ₹{(order.grandTotal || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                          </span>
                          <ChevronDown size={14} className={`text-gray-400 transition ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </div>

                      {/* Info row */}
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
                        <span>{line?.productName} · {line?.quantity} {line?.unit}</span>
                        <span>@ ₹{(line?.rate || 0).toLocaleString('en-IN')}</span>
                        <span>{new Date(order.orderDate).toLocaleDateString('en-IN')}</span>
                        {nextAction && phase !== 'CANCELLED' && (
                          <span className={`${colors.nextText} font-medium flex items-center gap-0.5`}>
                            <ChevronRight size={10} /> {nextAction}
                          </span>
                        )}
                      </div>

                      {/* Pipeline progress bar */}
                      {phase !== 'CANCELLED' && (
                        <div className="flex gap-0.5 mt-2">
                          {PHASE_STEPS.map((step, i) => (
                            <div key={step.key} className="flex-1 flex flex-col items-center">
                              <div className={`w-full h-1.5 rounded-full ${
                                i <= phaseIdx ? colors.bar : 'bg-gray-200'
                              } ${i === phaseIdx ? 'animate-pulse' : ''}`} />
                              <span className={`text-[8px] mt-0.5 ${
                                i <= phaseIdx ? `${colors.text} font-medium` : 'text-gray-400'
                              }`}>{step.label}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </button>

                    {/* Download SO PDF */}
                    <button onClick={async () => {
                        try {
                          const resp = await api.get(`/sales-orders/${order.id}/pdf`, { responseType: 'blob' });
                          window.open(window.URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' })), '_blank');
                        } catch { flash('err', 'PDF generation failed'); }
                      }}
                      className="text-gray-300 hover:text-blue-500 transition shrink-0 p-1"
                      title="Download SO Document">
                      <FileText size={14} />
                    </button>

                    {/* Quick delete */}
                    <button onClick={() => deleteOrder(order)}
                      disabled={!!actionLoading}
                      className="text-gray-300 hover:text-red-500 transition shrink-0 p-1"
                      title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>

                  {/* ── Expanded Details ── */}
                  {isExpanded && (
                    <div className="border-t bg-gray-50 p-4 space-y-3">
                      {/* Order details */}
                      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                        <div><span className="text-gray-500">Delivery</span><br/><span className="font-medium">{new Date(order.deliveryDate).toLocaleDateString('en-IN')}</span></div>
                        <div><span className="text-gray-500">Payment</span><br/><span className="font-medium">{order.paymentTerms}</span></div>
                        <div><span className="text-gray-500">Logistics</span><br/><span className="font-medium">{order.logisticsBy}</span></div>
                        <div><span className="text-gray-500">Amount</span><br/><span className="font-medium">₹{(order.totalAmount || 0).toLocaleString('en-IN')}</span></div>
                        <div><span className="text-gray-500">Grand Total</span><br/><span className="font-bold">₹{(order.grandTotal || 0).toLocaleString('en-IN')}</span></div>
                      </div>

                      {/* ── Dispatch Requests ── */}
                      {drs.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                            <Truck size={12} /> Dispatch Requests
                          </div>
                          {drs.map(dr => {
                            const drShipments = dr.shipments || [];
                            const isScheduled = ['SCHEDULED', 'PENDING', 'ACCEPTED', 'VEHICLE_ASSIGNED'].includes(dr.status);
                            return (
                              <div key={dr.id} className="bg-white rounded-lg border p-3 mb-2">
                                <div className="flex items-center justify-between mb-2">
                                  <div className="flex items-center gap-2">
                                    <span className="font-bold text-xs">DR #{dr.drNo}</span>
                                    <span className="text-[10px] text-gray-500">{dr.quantity} {dr.unit || 'MT'}</span>
                                  </div>
                                  <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                    ['DISPATCHED', 'COMPLETED'].includes(dr.status) ? 'bg-green-100 text-green-700' :
                                    dr.status === 'LOADING' ? 'bg-amber-100 text-amber-700' :
                                    'bg-blue-100 text-blue-700'
                                  }`}>{dr.status.replace(/_/g, ' ')}</span>
                                </div>

                                {/* Trucks under this DR */}
                                {drShipments.map(s => {
                                  const netKg = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
                                  return (
                                    <div key={s.id} className="bg-gray-50 rounded border p-2 mb-1.5">
                                      <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                          <span className="font-bold text-xs">{s.vehicleNo}</span>
                                          {s.driverName && <span className="text-[10px] text-gray-500">{s.driverName}</span>}
                                          {s.transporterName && <span className="text-[10px] text-gray-400">({s.transporterName})</span>}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {netKg && <span className="text-xs font-bold text-green-700">{(netKg / 1000).toFixed(2)} MT</span>}
                                          <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${
                                            ['RELEASED', 'EXITED'].includes(s.status) ? 'bg-green-100 text-green-700' :
                                            s.status === 'LOADING' ? 'bg-amber-100 text-amber-700' :
                                            s.status === 'GROSS_WEIGHED' ? 'bg-orange-100 text-orange-700' :
                                            'bg-blue-100 text-blue-700'
                                          }`}>{s.status.replace(/_/g, ' ')}</span>
                                        </div>
                                      </div>

                                      {/* Weighbridge progress */}
                                      <div className="flex gap-0.5 mt-1.5">
                                        {['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'].map((step, i) => {
                                          const stepIdx = ['GATE_IN', 'TARE_WEIGHED', 'LOADING', 'GROSS_WEIGHED', 'RELEASED', 'EXITED'].indexOf(s.status);
                                          return <div key={step} className={`h-1 flex-1 rounded-full ${i <= stepIdx ? 'bg-green-500' : 'bg-gray-200'}`} />;
                                        })}
                                      </div>

                                      {/* Inline actions per shipment status */}
                                      <div className="flex gap-1.5 mt-2 flex-wrap">
                                        {s.status === 'GATE_IN' && (
                                          weighFormShipment === s.id ? (
                                            <div className="flex gap-1 items-center w-full">
                                              <input type="number" step="0.01" value={weighValue} onChange={e => setWeighValue(e.target.value)}
                                                placeholder="Tare weight (kg)" className="input-field text-xs flex-1" autoFocus />
                                              <button onClick={() => { setWeighType('tare'); recordWeigh(s.id); }}
                                                disabled={!!actionLoading}
                                                className="px-3 py-1.5 bg-blue-600 text-white text-xs rounded font-medium hover:bg-blue-700 disabled:opacity-50">
                                                {actionLoading === s.id ? <Loader2 size={12} className="animate-spin" /> : 'Save Tare'}
                                              </button>
                                              <button onClick={() => setWeighFormShipment(null)} className="text-gray-400"><X size={14} /></button>
                                            </div>
                                          ) : (
                                            <button onClick={() => { setWeighFormShipment(s.id); setWeighType('tare'); setWeighValue(''); }}
                                              className="px-2 py-1 bg-gray-100 text-gray-700 text-[10px] rounded font-medium hover:bg-gray-200">
                                              ⚖️ Weigh Tare
                                            </button>
                                          )
                                        )}
                                        {s.status === 'TARE_WEIGHED' && (
                                          <button onClick={() => updateShipmentStatus(s.id, 'LOADING', { loadStartTime: new Date().toISOString() })}
                                            disabled={!!actionLoading}
                                            className="px-2 py-1 bg-blue-100 text-blue-700 text-[10px] rounded font-medium hover:bg-blue-200">
                                            {actionLoading === s.id ? <Loader2 size={10} className="animate-spin" /> : '▶️'} Start Loading
                                          </button>
                                        )}
                                        {s.status === 'LOADING' && (
                                          weighFormShipment === s.id ? (
                                            <div className="flex gap-1 items-center w-full">
                                              <input type="number" step="0.01" value={weighValue} onChange={e => setWeighValue(e.target.value)}
                                                placeholder="Gross weight (kg)" className="input-field text-xs flex-1" autoFocus />
                                              <button onClick={() => { setWeighType('gross'); recordWeigh(s.id); }}
                                                disabled={!!actionLoading}
                                                className="px-3 py-1.5 bg-amber-600 text-white text-xs rounded font-medium hover:bg-amber-700 disabled:opacity-50">
                                                {actionLoading === s.id ? <Loader2 size={12} className="animate-spin" /> : 'Save Gross'}
                                              </button>
                                              <button onClick={() => setWeighFormShipment(null)} className="text-gray-400"><X size={14} /></button>
                                            </div>
                                          ) : (
                                            <button onClick={() => { setWeighFormShipment(s.id); setWeighType('gross'); setWeighValue(''); }}
                                              className="px-2 py-1 bg-amber-100 text-amber-700 text-[10px] rounded font-medium hover:bg-amber-200">
                                              ⚖️ Weigh Gross
                                            </button>
                                          )
                                        )}
                                        {s.status === 'GROSS_WEIGHED' && (
                                          releaseFormShipment === s.id ? (
                                            <div className="flex gap-1 items-center w-full flex-wrap">
                                              <input value={releaseChallan} onChange={e => setReleaseChallan(e.target.value)}
                                                placeholder="Challan No" className="input-field text-xs flex-1 min-w-[100px]" />
                                              <input value={releaseEway} onChange={e => setReleaseEway(e.target.value)}
                                                placeholder="E-Way Bill" className="input-field text-xs flex-1 min-w-[100px]" />
                                              <button onClick={() => updateShipmentStatus(s.id, 'RELEASED', {
                                                challanNo: releaseChallan, ewayBill: releaseEway, releaseTime: new Date().toISOString()
                                              })}
                                                disabled={!!actionLoading}
                                                className="px-3 py-1.5 bg-orange-600 text-white text-xs rounded font-medium hover:bg-orange-700 disabled:opacity-50">
                                                {actionLoading === s.id ? <Loader2 size={12} className="animate-spin" /> : 'Release'}
                                              </button>
                                              <button onClick={() => setReleaseFormShipment(null)} className="text-gray-400"><X size={14} /></button>
                                            </div>
                                          ) : (
                                            <button onClick={() => setReleaseFormShipment(s.id)}
                                              className="px-2 py-1 bg-orange-100 text-orange-700 text-[10px] rounded font-medium hover:bg-orange-200">
                                              🔓 Release
                                            </button>
                                          )
                                        )}
                                        {s.status === 'RELEASED' && (
                                          <button onClick={() => updateShipmentStatus(s.id, 'EXITED', { exitTime: new Date().toISOString() })}
                                            disabled={!!actionLoading}
                                            className="px-2 py-1 bg-green-100 text-green-700 text-[10px] rounded font-medium hover:bg-green-200">
                                            {actionLoading === s.id ? <Loader2 size={10} className="animate-spin" /> : '🚗'} Gate Exit
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  );
                                })}

                                {/* Add truck button */}
                                {isScheduled && (
                                  truckFormDR === dr.id ? (
                                    <div className="bg-blue-50 rounded-lg p-2 border border-blue-200 mt-1">
                                      <div className="grid grid-cols-2 gap-2 mb-2">
                                        <input value={truckVehicle} onChange={e => setTruckVehicle(e.target.value)}
                                          placeholder="Vehicle No *" className="input-field text-xs" autoFocus />
                                        <input value={truckDriver} onChange={e => setTruckDriver(e.target.value)}
                                          placeholder="Driver" className="input-field text-xs" />
                                        <input value={truckMobile} onChange={e => setTruckMobile(e.target.value)}
                                          placeholder="Mobile" className="input-field text-xs" />
                                        <input value={truckTransporter} onChange={e => setTruckTransporter(e.target.value)}
                                          placeholder="Transporter" className="input-field text-xs" />
                                      </div>
                                      <div className="flex gap-2">
                                        <button onClick={() => assignTruck(dr.id)}
                                          disabled={!!actionLoading}
                                          className="flex-1 py-1.5 bg-blue-600 text-white text-xs rounded font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1">
                                          {actionLoading === dr.id ? <Loader2 size={12} className="animate-spin" /> : <Truck size={12} />}
                                          Gate In
                                        </button>
                                        <button onClick={() => setTruckFormDR(null)} className="px-3 py-1.5 text-gray-500 text-xs">Cancel</button>
                                      </div>
                                    </div>
                                  ) : (
                                    <button onClick={() => setTruckFormDR(dr.id)}
                                      className="w-full py-1.5 border border-dashed border-blue-300 rounded text-blue-600 text-xs font-medium hover:bg-blue-50 flex items-center justify-center gap-1 mt-1">
                                      <Plus size={12} /> Add Truck
                                    </button>
                                  )
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* No DR yet */}
                      {drs.length === 0 && order.status !== 'CANCELLED' && (
                        <div className="bg-purple-50 rounded-lg p-3 border border-purple-200 text-center">
                          <p className="text-xs text-purple-700 mb-2">Not yet sent to logistics</p>
                          <button onClick={async () => {
                            setActionLoading(order.id);
                            try {
                              await api.post('/dispatch-requests', {
                                orderId: order.id, customerId: order.customerId,
                                productName: line?.productName || 'DDGS',
                                quantity: line?.quantity || 0, unit: line?.unit || 'MT',
                                logisticsBy: order.logisticsBy, deliveryDate: order.deliveryDate,
                                remarks: order.remarks || '',
                              });
                              flash('ok', 'Sent to logistics');
                              loadAll();
                            } catch (e: any) { flash('err', e.response?.data?.error || 'Failed'); }
                            finally { setActionLoading(null); }
                          }}
                            disabled={!!actionLoading}
                            className="px-4 py-2 bg-purple-600 text-white text-xs font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50">
                            {actionLoading === order.id ? <Loader2 size={14} className="animate-spin" /> : <Truck size={14} />}
                            {' '}Send to Logistics
                          </button>
                        </div>
                      )}

                      {/* ── Invoices ── */}
                      {invoices.length > 0 && (
                        <div>
                          <div className="text-xs font-semibold text-gray-600 mb-2 flex items-center gap-1">
                            <Receipt size={12} /> Invoices
                          </div>
                          {invoices.map(inv => (
                            <div key={inv.id} className="bg-white rounded border p-2 mb-1 flex items-center justify-between">
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-bold">INV #{inv.invoiceNo}</span>
                                <span>₹{inv.totalAmount?.toLocaleString('en-IN')}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                                  inv.status === 'PAID' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                }`}>{inv.status}</span>
                                <button onClick={async () => {
                                  try {
                                    const resp = await api.get(`/invoices/${inv.id}/pdf`, { responseType: 'blob' });
                                    window.open(window.URL.createObjectURL(new Blob([resp.data], { type: 'application/pdf' })), '_blank');
                                  } catch { flash('err', 'PDF failed'); }
                                }}
                                  className="text-blue-600 text-[10px] font-medium hover:underline">
                                  Print
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Create invoice button (when shipment done, no invoice yet) */}
                      {invoices.length === 0 && allShipments.some(s => ['RELEASED', 'EXITED'].includes(s.status)) && (
                        <button onClick={() => {
                          const completedShipment = allShipments.find(s => ['RELEASED', 'EXITED'].includes(s.status));
                          if (completedShipment) createInvoice(order, completedShipment);
                        }}
                          disabled={!!actionLoading}
                          className="w-full py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center justify-center gap-2">
                          {actionLoading === order.id + '_inv' ? <Loader2 size={14} className="animate-spin" /> : <Receipt size={14} />}
                          Create Invoice
                        </button>
                      )}
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
