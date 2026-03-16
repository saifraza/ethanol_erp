import { useState, useEffect } from 'react';
import { ClipboardList, Plus, X, Save, Loader2, Trash2, ChevronDown } from 'lucide-react';
import api from '../../services/api';

interface Customer {
  id: string;
  name: string;
}

interface LineItem {
  productName: string;
  quantity: number;
  unit: string;
  rate: number;
  gstPercent: number;
  amount?: number;
  gst?: number;
  total?: number;
}

interface SalesOrder {
  id: string;
  orderNo: string;
  customerId: string;
  customerName: string;
  orderDate: string;
  deliveryDate: string;
  poNumber?: string;
  paymentTerms: string;
  logisticsBy: string;
  transporterName?: string;
  freightRate?: number;
  lineItems: LineItem[];
  remarks?: string;
  status: string;
  grandTotal?: number;
  totalGst?: number;
  totalAmount?: number;
  createdAt: string;
}

export default function SalesOrders() {
  const [orders, setOrders] = useState<SalesOrder[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [filterCustomer, setFilterCustomer] = useState('');

  // Form fields
  const [editId, setEditId] = useState<string | null>(null);
  const [customerId, setCustomerId] = useState('');
  const [orderDate, setOrderDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [deliveryDate, setDeliveryDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split('T')[0];
  });
  const [poNumber, setPoNumber] = useState('');
  const [paymentTerms, setPaymentTerms] = useState('NET15');
  const [logisticsBy, setLogisticsBy] = useState('BUYER');
  const [transporterName, setTransporterName] = useState('');
  const [freightRate, setFreightRate] = useState('');
  const [lineItems, setLineItems] = useState<LineItem[]>([]);
  const [remarks, setRemarks] = useState('');

  const loadOrders = async () => {
    try {
      setLoading(true);
      const response = await api.get('/sales-orders');
      setOrders(response.data.orders || response.data);
    } catch (error) {
      setMsg({ type: 'err', text: 'Failed to load orders' });
    } finally {
      setLoading(false);
    }
  };

  const loadCustomers = async () => {
    try {
      const response = await api.get('/customers');
      setCustomers(response.data.customers || response.data);
    } catch (error) {
      console.error('Failed to load customers');
    }
  };

  useEffect(() => {
    loadOrders();
    loadCustomers();
  }, []);

  const filteredOrders = orders.filter(o => {
    const statusMatch = filterStatus === 'ALL' || o.status === filterStatus;
    const customerMatch = !filterCustomer || o.customerId === filterCustomer;
    return statusMatch && customerMatch;
  });

  const calculateLineItem = (item: LineItem): LineItem => {
    const amount = item.quantity * item.rate;
    const gst = amount * (item.gstPercent / 100);
    return {
      ...item,
      amount,
      gst,
      total: amount + gst,
    };
  };

  const calculateTotals = (items: LineItem[]) => {
    const calculatedItems = items.map(calculateLineItem);
    const totalAmount = calculatedItems.reduce((s, i) => s + (i.amount || 0), 0);
    const totalGst = calculatedItems.reduce((s, i) => s + (i.gst || 0), 0);
    return {
      items: calculatedItems,
      totalAmount,
      totalGst,
      grandTotal: totalAmount + totalGst,
    };
  };

  const resetForm = () => {
    setEditId(null);
    setCustomerId('');
    setOrderDate(new Date().toISOString().split('T')[0]);
    const d = new Date();
    d.setDate(d.getDate() + 7);
    setDeliveryDate(d.toISOString().split('T')[0]);
    setPoNumber('');
    setPaymentTerms('NET15');
    setLogisticsBy('BUYER');
    setTransporterName('');
    setFreightRate('');
    setLineItems([]);
    setRemarks('');
    setShowForm(false);
  };

  const addLineItem = () => {
    setLineItems([
      ...lineItems,
      { productName: 'DDGS', quantity: 0, unit: 'MT', rate: 0, gstPercent: 5 },
    ]);
  };

  const updateLineItem = (index: number, field: string, value: any) => {
    const updated = [...lineItems];
    updated[index] = { ...updated[index], [field]: value };
    setLineItems(updated);
  };

  const removeLineItem = (index: number) => {
    setLineItems(lineItems.filter((_, i) => i !== index));
  };

  const totals = calculateTotals(lineItems);

  async function saveOrder() {
    if (!customerId) {
      setMsg({ type: 'err', text: 'Please select a customer' });
      return;
    }
    if (lineItems.length === 0) {
      setMsg({ type: 'err', text: 'Add at least one line item' });
      return;
    }

    setSaving(true);
    setMsg(null);

    try {
      const payload = {
        customerId,
        orderDate,
        deliveryDate,
        poNumber,
        paymentTerms,
        logisticsBy,
        transporterName: logisticsBy === 'SELLER' ? transporterName : undefined,
        freightRate: logisticsBy === 'SELLER' ? parseFloat(freightRate) : undefined,
        lineItems: totals.items,
        remarks,
      };

      if (editId) {
        await api.put(`/sales-orders/${editId}`, payload);
        setMsg({ type: 'ok', text: 'Order updated!' });
      } else {
        await api.post('/sales-orders', payload);
        setMsg({ type: 'ok', text: 'Order created!' });
      }

      resetForm();
      loadOrders();
    } catch (error) {
      setMsg({ type: 'err', text: 'Save failed' });
    } finally {
      setSaving(false);
    }
  }

  const getStatusColor = (status: string) => {
    const colors: { [key: string]: string } = {
      DRAFT: 'bg-gray-100 text-gray-700',
      CONFIRMED: 'bg-blue-100 text-blue-700',
      IN_PROGRESS: 'bg-amber-100 text-amber-700',
      COMPLETED: 'bg-green-100 text-green-700',
      CANCELLED: 'bg-red-100 text-red-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-purple-600 to-purple-700 text-white">
        <div className="max-w-5xl mx-auto px-4 py-4 md:py-6">
          <div className="flex items-center gap-3 mb-2">
            <ClipboardList size={32} />
            <h1 className="text-2xl md:text-3xl font-bold">Sales Orders</h1>
          </div>
          <p className="text-purple-100">Create and manage customer orders</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-5xl mx-auto px-4 py-6">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.text}
          </div>
        )}

        {/* Filter Bar */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Status</label>
            <select
              value={filterStatus}
              onChange={e => setFilterStatus(e.target.value)}
              className="input-field w-full text-sm"
            >
              <option value="ALL">All Status</option>
              <option value="DRAFT">Draft</option>
              <option value="CONFIRMED">Confirmed</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="COMPLETED">Completed</option>
              <option value="CANCELLED">Cancelled</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Customer</label>
            <select
              value={filterCustomer}
              onChange={e => setFilterCustomer(e.target.value)}
              className="input-field w-full text-sm"
            >
              <option value="">All Customers</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="w-full bg-purple-600 hover:bg-purple-700 text-white rounded-lg py-2 font-medium text-sm flex items-center justify-center gap-2"
              >
                <Plus size={16} /> New Order
              </button>
            )}
          </div>
        </div>

        {/* Order Form */}
        {showForm && (
          <div className="card mb-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="section-title !mb-0 flex items-center gap-2">
                <ClipboardList size={16} className="text-purple-600" /> New Sales Order
              </h3>
              <button onClick={resetForm} className="text-gray-400 hover:text-gray-600">
                <X size={18} />
              </button>
            </div>

            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-gray-500">Customer *</label>
                <select
                  value={customerId}
                  onChange={e => setCustomerId(e.target.value)}
                  className="input-field w-full text-sm"
                >
                  <option value="">Select Customer</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Reference (optional)</label>
                <input
                  value={poNumber}
                  onChange={e => setPoNumber(e.target.value)}
                  className="input-field w-full text-sm"
                  placeholder="Customer PO / verbal ref"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-gray-500">Order Date</label>
                <input
                  type="date"
                  value={orderDate}
                  onChange={e => setOrderDate(e.target.value)}
                  className="input-field w-full text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-gray-500">Delivery Date</label>
                <input
                  type="date"
                  value={deliveryDate}
                  onChange={e => setDeliveryDate(e.target.value)}
                  className="input-field w-full text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
              <div>
                <label className="text-xs text-gray-500">Payment Terms</label>
                <select
                  value={paymentTerms}
                  onChange={e => setPaymentTerms(e.target.value)}
                  className="input-field w-full text-sm"
                >
                  <option value="ADVANCE">Advance</option>
                  <option value="COD">Cash on Delivery</option>
                  <option value="NET7">Net 7 Days</option>
                  <option value="NET15">Net 15 Days</option>
                  <option value="NET30">Net 30 Days</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500">Logistics By</label>
                <div className="flex gap-3 mt-1.5">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      value="BUYER"
                      checked={logisticsBy === 'BUYER'}
                      onChange={e => setLogisticsBy(e.target.value)}
                      className="w-4 h-4"
                    />
                    Buyer
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      value="SELLER"
                      checked={logisticsBy === 'SELLER'}
                      onChange={e => setLogisticsBy(e.target.value)}
                      className="w-4 h-4"
                    />
                    Seller
                  </label>
                </div>
              </div>
            </div>

            {logisticsBy === 'SELLER' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                <div>
                  <label className="text-xs text-gray-500">Transporter Name</label>
                  <input
                    value={transporterName}
                    onChange={e => setTransporterName(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="ABC Logistics"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500">Freight Rate (₹)</label>
                  <input
                    type="number"
                    value={freightRate}
                    onChange={e => setFreightRate(e.target.value)}
                    className="input-field w-full text-sm"
                    placeholder="5000"
                  />
                </div>
              </div>
            )}

            {/* Line Items */}
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-semibold text-gray-700">Line Items *</label>
                <button
                  onClick={addLineItem}
                  className="text-purple-600 hover:text-purple-700 text-xs font-medium flex items-center gap-1"
                >
                  <Plus size={14} /> Add Line
                </button>
              </div>

              <div className="space-y-2">
                {lineItems.map((item, idx) => (
                  <div key={idx} className="bg-gray-50 rounded-lg p-3 border border-gray-200">
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mb-2">
                      <div>
                        <label className="text-[10px] text-gray-500">Product</label>
                        <select
                          value={item.productName}
                          onChange={e => updateLineItem(idx, 'productName', e.target.value)}
                          className="input-field w-full text-xs"
                        >
                          <option value="DDGS">DDGS</option>
                          <option value="ETHANOL">Ethanol</option>
                          <option value="LFO">LFO</option>
                          <option value="HFO">HFO</option>
                          <option value="RS">RS</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">Qty</label>
                        <input
                          type="number"
                          value={item.quantity}
                          onChange={e => updateLineItem(idx, 'quantity', parseFloat(e.target.value) || 0)}
                          className="input-field w-full text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">Unit</label>
                        <select
                          value={item.unit}
                          onChange={e => updateLineItem(idx, 'unit', e.target.value)}
                          className="input-field w-full text-xs"
                        >
                          <option value="MT">MT</option>
                          <option value="KL">KL</option>
                          <option value="L">L</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">Rate (₹)</label>
                        <input
                          type="number"
                          value={item.rate}
                          onChange={e => updateLineItem(idx, 'rate', parseFloat(e.target.value) || 0)}
                          className="input-field w-full text-xs"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] text-gray-500">GST %</label>
                        <input
                          type="number"
                          value={item.gstPercent}
                          onChange={e => updateLineItem(idx, 'gstPercent', parseFloat(e.target.value) || 0)}
                          className="input-field w-full text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <div className="text-gray-600">
                        Amount: <span className="font-semibold">₹{((item.quantity * item.rate) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                        {' '} + GST: <span className="font-semibold">₹{(((item.quantity * item.rate) * item.gstPercent / 100) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                      </div>
                      <button
                        onClick={() => removeLineItem(idx)}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Totals */}
            {lineItems.length > 0 && (
              <div className="bg-purple-50 rounded-lg p-3 mb-4 border border-purple-200">
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-600">Amount:</span>
                    <span className="font-semibold">₹{totals.totalAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-600">GST:</span>
                    <span className="font-semibold">₹{totals.totalGst.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  </div>
                  <div className="flex justify-between border-t pt-1 text-base">
                    <span className="font-bold">Grand Total:</span>
                    <span className="font-bold text-purple-700">₹{totals.grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                  </div>
                </div>
              </div>
            )}

            <div className="mb-4">
              <label className="text-xs text-gray-500">Remarks</label>
              <textarea
                value={remarks}
                onChange={e => setRemarks(e.target.value)}
                className="input-field w-full text-sm"
                placeholder="Special instructions..."
                rows={2}
              />
            </div>

            <button
              onClick={saveOrder}
              disabled={saving}
              className="w-full py-2.5 bg-purple-600 text-white rounded-lg font-medium text-sm hover:bg-purple-700 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              Create Order
            </button>
          </div>
        )}

        {/* Loading State */}
        {loading && (
          <div className="text-center py-8 text-gray-400">
            <Loader2 size={32} className="animate-spin mx-auto mb-2" />
            Loading orders...
          </div>
        )}

        {/* Order Cards */}
        {!loading && filteredOrders.length > 0 && (
          <div className="space-y-3">
            {filteredOrders.map(order => {
              const lineCount = order.lineItems?.length || 0;
              const firstProduct = order.lineItems?.[0]?.productName || '';
              return (
                <div key={order.id} className="bg-white border rounded-lg shadow-sm hover:shadow-md transition-shadow">
                  {/* Order Header */}
                  <button
                    onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
                    className="w-full p-4 text-left hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex-1">
                        <h3 className="font-bold text-sm text-gray-900">Order #{order.orderNo || order.id.slice(-6)}</h3>
                        <p className="text-xs text-gray-600 mt-0.5">{order.customerName}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-base text-purple-700">
                          ₹{(order.grandTotal || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}
                        </p>
                        <span className={`inline-block text-xs font-medium px-2 py-1 rounded mt-1 ${getStatusColor(order.status)}`}>
                          {order.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2 items-center text-xs text-gray-600">
                      <span>{new Date(order.orderDate).toLocaleDateString('en-IN')}</span>
                      <span>•</span>
                      <span>{lineCount} item{lineCount !== 1 ? 's' : ''}</span>
                      {firstProduct && (
                        <>
                          <span>•</span>
                          <span>{firstProduct}</span>
                        </>
                      )}
                    </div>
                  </button>

                  {/* Expanded Details */}
                  {expandedId === order.id && (
                    <div className="px-4 pb-4 border-t pt-3 bg-gray-50">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs mb-3">
                        <div>
                          <p className="text-gray-500">Order Date</p>
                          <p className="text-gray-700 font-medium">{new Date(order.orderDate).toLocaleDateString('en-IN')}</p>
                        </div>
                        <div>
                          <p className="text-gray-500">Delivery Date</p>
                          <p className="text-gray-700 font-medium">{new Date(order.deliveryDate).toLocaleDateString('en-IN')}</p>
                        </div>
                        {order.poNumber && (
                          <div>
                            <p className="text-gray-500">Reference</p>
                            <p className="text-gray-700 font-medium">{order.poNumber}</p>
                          </div>
                        )}
                        <div>
                          <p className="text-gray-500">Payment Terms</p>
                          <p className="text-gray-700 font-medium">{order.paymentTerms}</p>
                        </div>
                      </div>

                      {/* Line Items Table */}
                      {order.lineItems && order.lineItems.length > 0 && (
                        <div className="mb-3 overflow-x-auto">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b bg-gray-100">
                                <th className="text-left px-2 py-1">Product</th>
                                <th className="text-right px-2 py-1">Qty</th>
                                <th className="text-right px-2 py-1">Rate</th>
                                <th className="text-right px-2 py-1">Amount</th>
                              </tr>
                            </thead>
                            <tbody>
                              {order.lineItems.map((item, idx) => (
                                <tr key={idx} className="border-b">
                                  <td className="px-2 py-1">{item.productName}</td>
                                  <td className="text-right px-2 py-1">{item.quantity} {item.unit}</td>
                                  <td className="text-right px-2 py-1">₹{item.rate}</td>
                                  <td className="text-right px-2 py-1">₹{((item.quantity * item.rate) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Order Totals */}
                      <div className="bg-white rounded border p-2 mb-3">
                        <div className="flex justify-between text-xs mb-1">
                          <span>Amount</span>
                          <span>₹{(order.totalAmount || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                        </div>
                        <div className="flex justify-between text-xs mb-1">
                          <span>GST</span>
                          <span>₹{(order.totalGst || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                        </div>
                        <div className="flex justify-between font-semibold text-sm border-t pt-1">
                          <span>Grand Total</span>
                          <span>₹{(order.grandTotal || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                        </div>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex gap-2 flex-wrap">
                        {order.status === 'DRAFT' && (
                          <button
                            onClick={async () => {
                              try {
                                await api.put(`/sales-orders/${order.id}/status`, { status: 'CONFIRMED' });
                                loadOrders();
                              } catch (e: any) {
                                alert(e.response?.data?.error || 'Failed to confirm');
                              }
                            }}
                            className="px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                          >
                            Confirm Order
                          </button>
                        )}
                        {order.status === 'CONFIRMED' && (
                          <button
                            onClick={async () => {
                              try {
                                await api.put(`/sales-orders/${order.id}/status`, { status: 'IN_PROGRESS' });
                                loadOrders();
                              } catch (e: any) {
                                alert(e.response?.data?.error || 'Failed');
                              }
                            }}
                            className="px-3 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700"
                          >
                            Mark In Progress
                          </button>
                        )}
                        {['DRAFT', 'CONFIRMED'].includes(order.status) && (
                          <button
                            onClick={async () => {
                              if (!confirm('Cancel this order?')) return;
                              try {
                                await api.put(`/sales-orders/${order.id}/status`, { status: 'CANCELLED' });
                                loadOrders();
                              } catch (e: any) {
                                alert(e.response?.data?.error || 'Failed');
                              }
                            }}
                            className="px-3 py-2 bg-red-50 text-red-700 text-sm font-medium rounded-lg border border-red-300 hover:bg-red-100"
                          >
                            Cancel
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

        {/* Empty State */}
        {!loading && filteredOrders.length === 0 && (
          <div className="text-center py-12">
            <ClipboardList size={48} className="mx-auto text-gray-300 mb-3" />
            <p className="text-gray-500">No orders found. Create your first order to get started.</p>
          </div>
        )}
      </div>
    </div>
  );
}
