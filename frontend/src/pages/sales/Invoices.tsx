import { useState, useEffect } from 'react';
import { FileText, Plus, X, Loader2, Save, ChevronDown, Printer, RotateCcw } from 'lucide-react';
import api from '../../services/api';

interface Invoice {
  id: string;
  invoiceNo: number;
  invoiceDate: string;
  customer: { id: string; name: string; shortName?: string };
  customerId: string;
  productName: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  gstPercent: number;
  gstAmount: number;
  freightCharge: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  challanNo?: string;
  ewayBill?: string;
  payments?: Payment[];
}

interface Payment {
  paymentDate: string;
  mode: string;
  amount: number;
  reference?: string;
}

interface Customer {
  id: string;
  name: string;
}

interface FilterState {
  customerId?: string;
  status: 'ALL' | 'UNPAID' | 'PARTIAL' | 'PAID';
  dateFrom?: string;
  dateTo?: string;
}

export default function Invoices() {
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [filters, setFilters] = useState<FilterState>({ status: 'ALL' });
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Create invoice form
  const [formCustomerId, setFormCustomerId] = useState('');
  const [formProduct, setFormProduct] = useState('DDGS');
  const [formQty, setFormQty] = useState('');
  const [formRate, setFormRate] = useState('');
  const [formGst, setFormGst] = useState('18');
  const [formFreight, setFormFreight] = useState('');
  const [formChallanNo, setFormChallanNo] = useState('');

  // Computed stats
  const totalOutstanding = invoices.reduce((s, inv) => s + inv.balanceAmount, 0);
  const thisMonthBilled = invoices
    .filter(inv => {
      const d = new Date(inv.invoiceDate);
      const now = new Date();
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    })
    .reduce((s, inv) => s + inv.totalAmount, 0);

  // Load invoices with filters
  const loadInvoices = (filterState: FilterState) => {
    const params = new URLSearchParams();
    if (filterState.customerId) params.append('customerId', filterState.customerId);
    if (filterState.status !== 'ALL') params.append('status', filterState.status);
    if (filterState.dateFrom) params.append('from', filterState.dateFrom);
    if (filterState.dateTo) params.append('to', filterState.dateTo);

    api.get(`/invoices?${params.toString()}`)
      .then(r => {
        setInvoices(r.data.invoices || []);
      })
      .catch(() => setMsg({ type: 'err', text: 'Failed to load invoices' }));
  };

  // Load customers for dropdown
  const loadCustomers = () => {
    api.get('/customers')
      .then(r => setCustomers(r.data.customers || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadInvoices(filters);
    loadCustomers();
  }, []);

  const handleFilterChange = (newFilter: Partial<FilterState>) => {
    const updated = { ...filters, ...newFilter };
    setFilters(updated);
    loadInvoices(updated);
  };

  const resetCreateForm = () => {
    setFormCustomerId('');
    setFormProduct('DDGS');
    setFormQty('');
    setFormRate('');
    setFormGst('18');
    setFormFreight('');
    setFormChallanNo('');
    setShowCreateForm(false);
  };

  async function saveInvoice() {
    if (!formCustomerId || !formQty || !formRate) {
      setMsg({ type: 'err', text: 'Customer, qty, and rate required' });
      return;
    }

    setSaving(true);
    setMsg(null);
    try {
      await api.post('/invoices', {
        customerId: formCustomerId,
        productName: formProduct,
        quantity: parseFloat(formQty),
        rate: parseFloat(formRate),
        gstPercent: parseFloat(formGst),
        freightCharge: parseFloat(formFreight) || 0,
        challanNo: formChallanNo || null,
      });

      setMsg({ type: 'ok', text: 'Invoice created!' });
      resetCreateForm();
      loadInvoices(filters);
    } catch {
      setMsg({ type: 'err', text: 'Save failed' });
    }
    setSaving(false);
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'PAID': return 'bg-green-100 text-green-800';
      case 'PARTIAL': return 'bg-amber-100 text-amber-800';
      default: return 'bg-red-100 text-red-800';
    }
  };

  const progressPercent = (inv: Invoice) => {
    return inv.totalAmount > 0 ? (inv.paidAmount / inv.totalAmount) * 100 : 0;
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-700 to-emerald-800 text-white">
        <div className="max-w-7xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <FileText size={24} /> Invoices
              </h1>
              <p className="text-xs text-emerald-200 mt-1">{new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
            <div className="flex items-center gap-3">
              <button onClick={() => { loadInvoices(filters); }} className="p-2 hover:bg-emerald-600 rounded-lg transition text-sm text-emerald-100" title="Refresh">
                <RotateCcw size={18} />
              </button>
              {!showCreateForm && (
                <button onClick={() => setShowCreateForm(true)}
                  className="bg-white text-emerald-700 px-4 py-2 rounded-lg font-semibold text-sm hover:bg-emerald-50 flex items-center gap-2 shadow-md transition">
                  <Plus size={16} /> New Invoice
                </button>
              )}
            </div>
          </div>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-emerald-600 bg-opacity-40 rounded-lg px-4 py-3 backdrop-blur-sm">
              <p className="text-emerald-100 text-xs font-medium">Outstanding</p>
              <p className="text-white text-xl font-bold">₹{(totalOutstanding / 100000).toFixed(1)}L</p>
            </div>
            <div className="bg-emerald-600 bg-opacity-40 rounded-lg px-4 py-3 backdrop-blur-sm">
              <p className="text-emerald-100 text-xs font-medium">This Month</p>
              <p className="text-white text-xl font-bold">₹{(thisMonthBilled / 100000).toFixed(1)}L</p>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.text}
          </div>
        )}

        {/* Filters */}
        <div className="flex gap-2 mb-6 overflow-x-auto pb-2">
          {['ALL', 'UNPAID', 'PARTIAL', 'PAID'].map(s => (
            <button
              key={s}
              onClick={() => handleFilterChange({ status: s as any })}
              className={`px-4 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition ${filters.status === s ? 'bg-emerald-600 text-white shadow-md' : 'bg-white text-gray-600 border border-gray-200 hover:border-emerald-300 hover:bg-emerald-50'}`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Filters Panel */}
        <div className="bg-white rounded-xl border border-gray-200 p-4 mb-6 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">Customer</label>
              <select
                value={filters.customerId || ''}
                onChange={e => handleFilterChange({ customerId: e.target.value || undefined })}
                className="input-field w-full text-sm"
              >
              <option value="">All Customers</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-700 mb-2">Date Range</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] text-gray-500">From</label>
                  <input
                    type="date"
                    value={filters.dateFrom || ''}
                    onChange={e => handleFilterChange({ dateFrom: e.target.value || undefined })}
                    className="input-field w-full text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-[10px] text-gray-500">To</label>
                  <input
                    type="date"
                    value={filters.dateTo || ''}
                    onChange={e => handleFilterChange({ dateTo: e.target.value || undefined })}
                    className="input-field w-full text-sm mt-1"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Create Invoice Form */}
        {showCreateForm && (
          <div className="bg-white rounded-xl border border-emerald-200 shadow-lg mb-6 overflow-hidden">
            <div className="bg-gradient-to-r from-emerald-700 to-emerald-800 px-4 py-3 flex items-center justify-between">
              <h3 className="font-bold text-white text-sm">New Invoice</h3>
              <button onClick={resetCreateForm} className="text-emerald-200 hover:text-white"><X size={18} /></button>
            </div>

            <div className="p-4 space-y-4">
              <div>
                <label className="text-xs text-gray-500 font-medium">Customer *</label>
                <select
                  value={formCustomerId}
                  onChange={e => setFormCustomerId(e.target.value)}
                  className="input-field w-full text-sm mt-1"
                >
                  <option value="">Select Customer</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-xs text-gray-500 font-medium">Product</label>
                <select
                  value={formProduct}
                  onChange={e => setFormProduct(e.target.value)}
                  className="input-field w-full text-sm mt-1"
                >
                  {['DDGS', 'ETHANOL', 'LFO', 'HFO', 'RS'].map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Qty *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formQty}
                    onChange={e => setFormQty(e.target.value)}
                    placeholder="0"
                    className="input-field w-full text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Rate *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formRate}
                    onChange={e => setFormRate(e.target.value)}
                    placeholder="0"
                    className="input-field w-full text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">GST %</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formGst}
                    onChange={e => setFormGst(e.target.value)}
                    className="input-field w-full text-sm mt-1"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 font-medium">Freight</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formFreight}
                    onChange={e => setFormFreight(e.target.value)}
                    placeholder="0"
                    className="input-field w-full text-sm mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Challan No</label>
                  <input
                    value={formChallanNo}
                    onChange={e => setFormChallanNo(e.target.value)}
                    placeholder="Optional"
                    className="input-field w-full text-sm mt-1"
                  />
                </div>
              </div>

              <button
                onClick={saveInvoice}
                disabled={saving}
                className="px-6 py-3 bg-emerald-600 text-white rounded-lg font-bold text-sm hover:bg-emerald-700 flex items-center justify-center gap-2 disabled:opacity-50 w-full shadow-md transition"
              >
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                Create Invoice
              </button>
            </div>
          </div>
        )}

        {/* Invoice Cards */}
        <div className="space-y-3">
          {invoices.length > 0 ? (
            invoices.map(inv => (
              <div key={inv.id} className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition">
                {/* Summary Row */}
                <button
                  onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}
                  className="w-full p-4 hover:bg-gray-50 flex items-center justify-between"
                >
                  <div className="text-left flex-1">
                    <div className="font-bold text-gray-900">INV-{inv.invoiceNo}</div>
                    <div className="text-sm text-gray-600">{inv.customer?.name || '—'}</div>
                    <div className="text-xs text-gray-500 mt-1">{new Date(inv.invoiceDate).toLocaleDateString('en-IN')}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-lg text-gray-900">₹{inv.totalAmount.toLocaleString('en-IN')}</div>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${statusColor(inv.status)}`}>
                      {inv.status}
                    </span>
                  </div>
                  <ChevronDown
                    size={20}
                    className={`ml-2 text-gray-400 transition-transform ${expandedId === inv.id ? 'rotate-180' : ''}`}
                  />
                </button>

                {/* Payment Progress */}
                <div className="px-4 pb-3 border-t border-gray-100">
                  <div className="flex justify-between text-xs text-gray-600 mb-2">
                    <span>Paid ₹{inv.paidAmount.toLocaleString('en-IN')} / ₹{inv.totalAmount.toLocaleString('en-IN')}</span>
                    <span>{progressPercent(inv).toFixed(0)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className={`h-2 rounded-full transition-all ${
                        inv.status === 'PAID' ? 'bg-green-500' : inv.status === 'PARTIAL' ? 'bg-amber-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${Math.min(progressPercent(inv), 100)}%` }}
                    />
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedId === inv.id && (
                  <div className="px-4 py-3 bg-gray-50 border-t border-gray-100 space-y-3">
                    <div className="bg-white rounded-lg p-3 space-y-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Product:</span>
                        <span className="font-semibold text-gray-900">{inv.productName}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Qty:</span>
                        <span className="font-semibold text-gray-900">{inv.quantity} {inv.unit}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Rate:</span>
                        <span className="font-semibold text-gray-900">₹{inv.rate.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="border-t border-gray-200 pt-2 flex justify-between text-sm font-semibold">
                        <span className="text-gray-600">Base:</span>
                        <span className="text-gray-900">₹{inv.amount.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">GST ({inv.gstPercent}%):</span>
                        <span className="font-semibold text-gray-900">₹{inv.gstAmount.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-600">Freight:</span>
                        <span className="font-semibold text-gray-900">₹{inv.freightCharge.toLocaleString('en-IN')}</span>
                      </div>
                      <div className="border-t border-gray-200 pt-2 flex justify-between text-base font-bold">
                        <span>Total:</span>
                        <span className="text-gray-900">₹{inv.totalAmount.toLocaleString('en-IN')}</span>
                      </div>
                    </div>

                    {inv.balanceAmount > 0 && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <div className="text-sm font-semibold text-red-700">
                          Balance Due: ₹{inv.balanceAmount.toLocaleString('en-IN')}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => {
                        const token = localStorage.getItem('token');
                        window.open(`/api/invoices/${inv.id}/pdf?token=${token}`, '_blank');
                      }}
                      className="w-full px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition font-medium text-sm flex items-center justify-center gap-2"
                    >
                      <Printer size={16} />
                      Print Invoice PDF
                    </button>

                    {inv.payments && inv.payments.length > 0 && (
                      <div>
                        <div className="text-xs font-semibold text-gray-600 mb-2">PAYMENT HISTORY</div>
                        <div className="space-y-2">
                          {inv.payments.map((p, i) => (
                            <div key={i} className="flex justify-between text-sm bg-white rounded p-2">
                              <div>
                                <div className="text-gray-900 font-semibold">{p.mode}</div>
                                <div className="text-xs text-gray-500">{new Date(p.paymentDate).toLocaleDateString('en-IN')}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-gray-900 font-bold">₹{p.amount.toLocaleString('en-IN')}</div>
                                {p.reference && <div className="text-xs text-gray-500">{p.reference}</div>}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="text-center py-8 text-gray-500">
              <FileText size={48} className="mx-auto mb-2 opacity-30" />
              <p className="text-sm">No invoices found</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
