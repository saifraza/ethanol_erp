import { useState, useEffect } from 'react';
import {
  ClipboardList, Plus, X, Loader2, Trash2, ChevronDown, ChevronRight,
  Truck, FileText, CheckCircle, Clock, Package, Scale, Receipt,
  IndianRupee, Share2, Phone, AlertCircle, RotateCcw
} from 'lucide-react';
import api from '../../services/api';

// ── Types ──
interface Customer { id: string; name: string; address?: string; city?: string; state?: string; pincode?: string; }
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

const PHASE_COLORS: Record<string, { badge: string; bar: string; barActive: string; text: string; nextText: string }> = {
  ORDER:       { badge: 'bg-purple-100 text-purple-700 border-purple-300', bar: 'bg-purple-500', barActive: 'bg-purple-500', text: 'text-purple-600', nextText: 'text-purple-600' },
  LOGISTICS:   { badge: 'bg-orange-100 text-orange-700 border-orange-300', bar: 'bg-orange-500', barActive: 'bg-orange-500', text: 'text-orange-600', nextText: 'text-orange-600' },
  WEIGHBRIDGE: { badge: 'bg-amber-100 text-amber-700 border-amber-300', bar: 'bg-amber-500', barActive: 'bg-amber-500', text: 'text-amber-600', nextText: 'text-amber-600' },
  LOADING:     { badge: 'bg-green-100 text-green-700 border-green-300', bar: 'bg-green-500', barActive: 'bg-green-500', text: 'text-green-600', nextText: 'text-green-600' },
  INVOICED:    { badge: 'bg-blue-100 text-blue-700 border-blue-300', bar: 'bg-blue-500', barActive: 'bg-blue-500', text: 'text-blue-600', nextText: 'text-blue-600' },
  PAID:        { badge: 'bg-emerald-100 text-emerald-700 border-emerald-300', bar: 'bg-emerald-500', barActive: 'bg-emerald-500', text: 'text-emerald-600', nextText: 'text-emerald-600' },
  CANCELLED:   { badge: 'bg-red-100 text-red-700 border-red-300', bar: 'bg-red-500', barActive: 'bg-red-500', text: 'text-red-600', nextText: 'text-red-600' },
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
  const [deliveryAddress, setDeliveryAddress] = useState('');

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
    setFreightRate(''); setRemarks(''); setDeliveryAddress('');
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
        paymentTerms, logisticsBy, deliveryAddress: deliveryAddress || undefined,
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
        destination: deliveryAddress || '',
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
    <div className="p-3 md:p-6 space-y-0">
      {/* Page Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <h1 className="text-sm font-bold tracking-wide uppercase">Sales Pipeline</h1>
        <div className="flex items-center gap-2">
          {selectedIds.size > 0 && (
            <button onClick={bulkDelete} disabled={actionLoading === 'bulk'}
              className="px-3 py-1 bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 flex items-center gap-1">
              {actionLoading === 'bulk' ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
              Delete {selectedIds.size}
            </button>
          )}
          <button onClick={loadAll} className="px-2 py-1 text-slate-300 hover:text-white" title="Refresh">
            <RotateCcw size={14} />
          </button>
          {!showForm && (
            <button onClick={() => setShowForm(true)}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1">
              <Plus size={12} /> New Sale
            </button>
          )}
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="px-4 py-2.5 border-l-4 border-l-blue-500 border-r border-r-slate-200">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Orders</div>
          <div className="text-lg font-bold text-slate-800">{orders.length}</div>
        </div>
        <div className="px-4 py-2.5 border-l-4 border-l-emerald-500 border-r border-r-slate-200">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Pipeline Value</div>
          <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{'\u20B9'}{(totalValue / 100000).toFixed(1)}L</div>
        </div>
        <div className="px-4 py-2.5 border-l-4 border-l-amber-500">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Active</div>
          <div className="text-lg font-bold text-slate-800">{orders.filter(o => o.status !== 'CANCELLED').length}</div>
        </div>
      </div>

      {/* Phase Filter Bar */}
      <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex gap-1 overflow-x-auto">
        {[
          { key: 'ALL', label: 'All' },
          { key: 'ORDER', label: 'New' },
          { key: 'LOGISTICS', label: 'Logistics' },
          { key: 'WEIGHBRIDGE', label: 'Weighbridge' },
          { key: 'LOADING', label: 'Dispatched' },
          { key: 'INVOICED', label: 'Invoiced' },
          { key: 'PAID', label: 'Paid' },
        ].map(f => (
          <button key={f.key} onClick={() => setFilterPhase(f.key)}
            className={`px-3 py-1 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap transition ${
              filterPhase === f.key ? 'bg-white border-b-2 border-slate-800 text-slate-800' : 'text-slate-400 border-transparent hover:text-slate-600'
            }`}>
            {f.label} {phaseCounts[f.key] ? `(${phaseCounts[f.key]})` : ''}
          </button>
        ))}
      </div>

      {/* Flash message */}
      {msg && (
        <div className={`px-3 py-2 text-[11px] font-medium border -mx-3 md:-mx-6 ${
          msg.type === 'ok' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
        }`}>
          {msg.text}
        </div>
      )}

      {/* ── Create Form ── */}
      {showForm && (
        <div className="border border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
            <h3 className="text-sm font-bold tracking-wide uppercase">New Sale Order</h3>
            <button onClick={resetForm} className="text-slate-400 hover:text-white"><X size={16} /></button>
          </div>
          <div className="p-4 space-y-3 bg-white">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Customer *</label>
                <select value={customerId} onChange={e => {
                    setCustomerId(e.target.value);
                    const cust = customers.find(c => c.id === e.target.value);
                    if (cust && !deliveryAddress) {
                      const addr = [cust.address, cust.city, cust.state, cust.pincode].filter(Boolean).join(', ');
                      if (addr) setDeliveryAddress(addr);
                    }
                  }}
                  className="border border-slate-300 px-2.5 py-1.5 text-xs w-full">
                  <option value="">Select</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Delivery Date</label>
                <input type="date" value={deliveryDate} onChange={e => setDeliveryDate(e.target.value)}
                  className="border border-slate-300 px-2.5 py-1.5 text-xs w-full" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment</label>
                <select value={paymentTerms} onChange={e => setPaymentTerms(e.target.value)}
                  className="border border-slate-300 px-2.5 py-1.5 text-xs w-full">
                  <option value="ADVANCE">Advance</option>
                  <option value="COD">COD</option>
                  <option value="NET7">7 Days</option>
                  <option value="NET10">10 Days</option>
                  <option value="NET15">15 Days</option>
                  <option value="NET30">30 Days</option>
                </select>
              </div>
            </div>

            {lineItems.map((item, idx) => (
              <div key={idx} className="bg-slate-50 p-3 border border-slate-200">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Product</label>
                    <select value={item.productName} onChange={e => handleProductChange(idx, e.target.value)}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full">
                      <option value="DDGS">DDGS</option>
                      <option value="ETHANOL">Ethanol</option>
                      <option value="LFO">LFO</option>
                      <option value="HFO">HFO</option>
                      <option value="RS">RS</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Qty ({item.unit})</label>
                    <input type="number" value={item.quantity || ''} placeholder="300"
                      onChange={e => { const u = [...lineItems]; u[idx] = { ...u[idx], quantity: parseFloat(e.target.value) || 0 }; setLineItems(u); }}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Rate</label>
                    <input type="number" value={item.rate || ''} placeholder="18000"
                      onChange={e => { const u = [...lineItems]; u[idx] = { ...u[idx], rate: parseFloat(e.target.value) || 0 }; setLineItems(u); }}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">GST %</label>
                    <input type="number" value={item.gstPercent}
                      onChange={e => { const u = [...lineItems]; u[idx] = { ...u[idx], gstPercent: parseFloat(e.target.value) || 0 }; setLineItems(u); }}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full" />
                  </div>
                  <div className="flex items-end">
                    <div className="text-sm font-bold text-slate-700 font-mono tabular-nums">
                      {'\u20B9'}{(item.quantity * item.rate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                    </div>
                  </div>
                </div>
              </div>
            ))}

            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Delivery Address *</label>
              <input value={deliveryAddress} onChange={e => setDeliveryAddress(e.target.value)}
                placeholder="Full delivery address"
                className="border border-slate-300 px-2.5 py-1.5 text-xs w-full" />
            </div>

            <div className="flex items-center gap-4 text-sm">
              <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Transport:</span>
              <label className="flex items-center gap-1.5">
                <input type="radio" value="BUYER" checked={logisticsBy === 'BUYER'} onChange={e => setLogisticsBy(e.target.value)} className="w-3.5 h-3.5" />
                <span className="text-xs">Buyer arranges</span>
              </label>
              <label className="flex items-center gap-1.5">
                <input type="radio" value="SELLER" checked={logisticsBy === 'SELLER'} onChange={e => setLogisticsBy(e.target.value)} className="w-3.5 h-3.5" />
                <span className="text-xs">MSPIL arranges</span>
              </label>
              {logisticsBy === 'SELLER' && (
                <span className="text-[10px] text-orange-600 font-medium">Logistics team will set rate</span>
              )}
            </div>

            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 p-3">
              <div className="text-sm font-mono tabular-nums">
                <span className="text-slate-600">{'\u20B9'}{totals.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                <span className="text-slate-400"> + GST {'\u20B9'}{totals.totalGst.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
                <span className="text-lg font-bold text-slate-800 ml-3">= {'\u20B9'}{totals.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}</span>
              </div>
              <button onClick={createOrder} disabled={saving}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1">
                {saving ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                Create & Send to Logistics
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk actions bar */}
      {filtered.length > 0 && (
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-1.5 -mx-3 md:-mx-6 flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[10px] text-slate-500 cursor-pointer uppercase tracking-widest font-bold">
            <input type="checkbox" checked={selectedIds.size === filtered.length && filtered.length > 0}
              onChange={selectAll} className="w-3.5 h-3.5" />
            Select all
          </label>
          {selectedIds.size > 0 && (
            <span className="text-[10px] text-slate-400">{selectedIds.size} selected</span>
          )}
        </div>
      )}

      {/* ── Orders Table ── */}
      {loading ? (
        <div className="text-xs text-slate-400 uppercase tracking-widest text-center py-12">
          <Loader2 size={24} className="animate-spin mx-auto mb-2" />
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-xs text-slate-400 uppercase tracking-widest text-center py-12">
          No orders found
        </div>
      ) : (
        <div className="border-x border-slate-300 -mx-3 md:-mx-6">
          {filtered.map(({ order, phase, label, nextAction, pct, colors }, rowIdx) => {
            const line = order.lineItems?.[0] || (order as any).lines?.[0];
            const isExpanded = expandedId === order.id;
            const drs = order.dispatchRequests || [];
            const allShipments: Shipment[] = [];
            drs.forEach(dr => { if (dr.shipments) allShipments.push(...dr.shipments); });
            const invoices = order.invoices || [];
            const phaseIdx = PHASE_ORDER.indexOf(phase);

            return (
              <div key={order.id} className={`border-b border-slate-200 ${phase === 'CANCELLED' ? 'opacity-50' : ''} ${rowIdx % 2 === 0 ? '' : 'bg-slate-50/70'} hover:bg-blue-50/60`}>
                {/* Row */}
                <div className="flex items-center gap-3 px-4 py-2">
                  <input type="checkbox" checked={selectedIds.has(order.id)}
                    onChange={() => toggleSelect(order.id)}
                    className="w-3.5 h-3.5 shrink-0" />

                  <button onClick={() => setExpandedId(isExpanded ? null : order.id)}
                    className="flex-1 text-left min-w-0">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-bold text-xs text-slate-900">#{order.orderNo}</span>
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${colors.badge}`}>
                          {label}
                        </span>
                        <span className="text-xs text-slate-700 truncate">{order.customerName}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-xs font-bold text-slate-800 font-mono tabular-nums">
                          {'\u20B9'}{(order.grandTotal || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </span>
                        <ChevronDown size={12} className={`text-slate-400 transition ${isExpanded ? 'rotate-180' : ''}`} />
                      </div>
                    </div>

                    <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-500">
                      <span>{line?.productName} | {line?.quantity} {line?.unit}</span>
                      <span>@ {'\u20B9'}{(line?.rate || 0).toLocaleString('en-IN')}</span>
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
                            <div className={`w-full h-1.5 ${
                              i <= phaseIdx ? colors.bar : 'bg-slate-200'
                            } ${i === phaseIdx ? 'animate-pulse' : ''}`} />
                            <span className={`text-[8px] mt-0.5 ${
                              i <= phaseIdx ? `${colors.text} font-medium` : 'text-slate-400'
                            }`}>{step.label}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </button>

                  <button onClick={() => {
                      const token = localStorage.getItem('token');
                      window.open(`/api/sales-orders/${order.id}/pdf?token=${token}`, '_blank');
                    }}
                    className="text-slate-300 hover:text-blue-500 transition shrink-0 p-1"
                    title="View SO Document">
                    <FileText size={14} />
                  </button>

                  <button onClick={() => deleteOrder(order)}
                    disabled={!!actionLoading}
                    className="text-slate-300 hover:text-red-500 transition shrink-0 p-1"
                    title="Delete">
                    <Trash2 size={14} />
                  </button>
                </div>

                {/* ── Expanded Details ── */}
                {isExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50 px-4 py-3 space-y-3">
                    {/* Order details */}
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-xs">
                      <div><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Delivery</span><br/><span className="font-medium">{new Date(order.deliveryDate).toLocaleDateString('en-IN')}</span></div>
                      <div><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Payment</span><br/><span className="font-medium">{order.paymentTerms}</span></div>
                      <div><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Logistics</span><br/><span className="font-medium">{order.logisticsBy}</span></div>
                      <div><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Amount</span><br/><span className="font-medium font-mono tabular-nums">{'\u20B9'}{(order.totalAmount || 0).toLocaleString('en-IN')}</span></div>
                      <div><span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Grand Total</span><br/><span className="font-bold font-mono tabular-nums">{'\u20B9'}{(order.grandTotal || 0).toLocaleString('en-IN')}</span></div>
                    </div>

                    {/* ── Dispatch Requests ── */}
                    {drs.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                          <Truck size={10} /> Dispatch Requests
                        </div>
                        {drs.map(dr => {
                          const drShipments = dr.shipments || [];
                          const totalQty = dr.quantity || 0;
                          const dispatchedMT = drShipments
                            .filter((s: any) => s.status === 'EXITED')
                            .reduce((sum: number, s: any) => {
                              const net = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : 0);
                              return sum + (net ? net / 1000 : 0);
                            }, 0);
                          const pctDispatched = totalQty > 0 ? Math.min(100, (dispatchedMT / totalQty) * 100) : 0;
                          const remainingMT = Math.max(0, totalQty - dispatchedMT);

                          return (
                            <div key={dr.id} className="bg-white border border-slate-200 p-3 mb-2">
                              <div className="flex items-center justify-between mb-2">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-xs">DR #{dr.drNo}</span>
                                  <span className="text-[10px] text-slate-500">{dr.quantity} {dr.unit || 'MT'}</span>
                                </div>
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                  ['DISPATCHED', 'COMPLETED'].includes(dr.status) ? 'bg-green-100 text-green-700 border-green-300' :
                                  dr.status === 'LOADING' ? 'bg-amber-100 text-amber-700 border-amber-300' :
                                  'bg-blue-100 text-blue-700 border-blue-300'
                                }`}>{dr.status.replace(/_/g, ' ')}</span>
                              </div>

                              {/* Dispatch progress */}
                              <div className="mb-2">
                                <div className="flex items-center justify-between text-[10px] mb-1">
                                  <span className="text-slate-500">Dispatched: <span className="font-bold text-green-700">{dispatchedMT.toFixed(1)} MT</span> / {totalQty} {dr.unit || 'MT'}</span>
                                  <span className={`font-bold ${pctDispatched >= 100 ? 'text-green-600' : 'text-orange-600'}`}>{pctDispatched.toFixed(0)}%</span>
                                </div>
                                <div className="w-full h-2 bg-slate-100 overflow-hidden">
                                  <div className={`h-full transition-all ${pctDispatched >= 100 ? 'bg-green-500' : 'bg-orange-500'}`}
                                    style={{ width: `${pctDispatched}%` }} />
                                </div>
                                {remainingMT > 0 && pctDispatched > 0 && (
                                  <p className="text-[10px] text-orange-600 mt-0.5">Remaining: {remainingMT.toFixed(1)} MT</p>
                                )}
                              </div>

                              {/* Trucks */}
                              {drShipments.length > 0 && (
                                <div className="space-y-1">
                                  {drShipments.map((s: any) => {
                                    const netKg = s.weightNet || (s.weightGross && s.weightTare ? s.weightGross - s.weightTare : null);
                                    const docs = s.documents || [];
                                    return (
                                      <div key={s.id} className="bg-slate-50 border border-slate-100 px-2 py-1.5 text-xs">
                                        <div className="flex items-center justify-between">
                                          <div className="flex items-center gap-2">
                                            <span className="font-bold">{s.vehicleNo}</span>
                                            {s.driverName && <span className="text-slate-500">{s.driverName}</span>}
                                          </div>
                                          <div className="flex items-center gap-2">
                                            {netKg != null && netKg > 0 && <span className="font-bold text-green-700 font-mono tabular-nums">{(netKg / 1000).toFixed(2)} MT</span>}
                                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                              ['RELEASED', 'EXITED'].includes(s.status) ? 'bg-green-100 text-green-700 border-green-300' :
                                              s.status === 'LOADING' ? 'bg-amber-100 text-amber-700 border-amber-300' :
                                              s.status === 'GROSS_WEIGHED' ? 'bg-orange-100 text-orange-700 border-orange-300' :
                                              'bg-blue-100 text-blue-700 border-blue-300'
                                            }`}>{s.status.replace(/_/g, ' ')}</span>
                                          </div>
                                        </div>
                                        {/* Document trail */}
                                        {(() => {
                                          const docTrail = [
                                            { label: 'Bill', has: !!(s.challanNo || s.invoiceRef || docs.some((d: any) => d.docType === 'INVOICE')) },
                                            { label: 'E-Way', has: !!(s.ewayBill || docs.some((d: any) => d.docType === 'EWAY_BILL')) },
                                            { label: 'Gate', has: !!(s.gatePassNo || docs.some((d: any) => d.docType === 'GATE_PASS')) },
                                            { label: 'Bilty', has: !!(s.grBiltyNo || docs.some((d: any) => d.docType === 'GR_BILTY')) },
                                          ];
                                          const doneCount = docTrail.filter(d => d.has).length;
                                          return (
                                            <div className="flex gap-1 mt-1.5">
                                              {docTrail.map((dt) => (
                                                <span key={dt.label} className={`flex-1 text-center py-1 text-[9px] font-bold border ${
                                                  dt.has
                                                    ? 'bg-green-50 text-green-700 border-green-200'
                                                    : 'bg-slate-50 text-slate-300 border-slate-100'
                                                }`}>{dt.label}</span>
                                              ))}
                                              <span className={`text-[9px] font-bold px-1.5 py-1 ${
                                                doneCount === 4 ? 'bg-green-100 text-green-700' : 'text-slate-400'
                                              }`}>{doneCount}/4</span>
                                            </div>
                                          );
                                        })()}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {drShipments.length === 0 && (
                                <p className="text-[10px] text-slate-400 italic">No trucks assigned yet</p>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* No DR yet */}
                    {drs.length === 0 && order.status !== 'CANCELLED' && (
                      <div className="bg-slate-50 border border-slate-200 p-3 text-center">
                        <p className="text-xs text-slate-500 mb-2">Not yet sent to logistics</p>
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
                          className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1">
                          {actionLoading === order.id ? <Loader2 size={12} className="animate-spin" /> : <Truck size={12} />}
                          Send to Logistics
                        </button>
                      </div>
                    )}

                    {/* ── Invoices ── */}
                    {invoices.length > 0 && (
                      <div>
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                          <Receipt size={10} /> Invoices
                        </div>
                        {invoices.map(inv => (
                          <div key={inv.id} className="bg-white border border-slate-200 p-2 mb-1 flex items-center justify-between">
                            <div className="flex items-center gap-2 text-xs">
                              <span className="font-bold">INV #{inv.invoiceNo}</span>
                              <span className="font-mono tabular-nums">{'\u20B9'}{inv.totalAmount?.toLocaleString('en-IN')}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                inv.status === 'PAID' ? 'bg-green-100 text-green-700 border-green-300' : 'bg-red-100 text-red-700 border-red-300'
                              }`}>{inv.status}</span>
                              <button onClick={() => {
                                  const token = localStorage.getItem('token');
                                  window.open(`/api/invoices/${inv.id}/pdf?token=${token}`, '_blank');
                                }}
                                className="text-blue-600 text-[10px] font-medium hover:underline">
                                Print
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Create invoice button */}
                    {invoices.length === 0 && allShipments.some(s => ['RELEASED', 'EXITED'].includes(s.status)) && (
                      <button onClick={() => {
                        const completedShipment = allShipments.find(s => ['RELEASED', 'EXITED'].includes(s.status));
                        if (completedShipment) createInvoice(order, completedShipment);
                      }}
                        disabled={!!actionLoading}
                        className="w-full py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-1">
                        {actionLoading === order.id + '_inv' ? <Loader2 size={12} className="animate-spin" /> : <Receipt size={12} />}
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
  );
}
