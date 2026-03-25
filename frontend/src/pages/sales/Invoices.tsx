import { useState, useEffect } from 'react';
import { FileText, Plus, X, Loader2, Save, ChevronDown, Printer, RotateCcw, FileCheck } from 'lucide-react';
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
  status: 'UNPAID' | 'PARTIAL' | 'PAID' | 'CANCELLED';
  // E-Invoice (IRN) fields
  irn?: string;
  irnDate?: string;
  irnStatus?: string;
  ackNo?: string;
  signedQRCode?: string;
  // E-Way Bill fields
  ewbNo?: string;
  ewbDate?: string;
  ewbValidTill?: string;
  ewbStatus?: string;
  // Document refs
  challanNo?: string;
  ewayBill?: string;
  remarks?: string;
  shipmentId?: string;
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
  const [generatingEInvoice, setGeneratingEInvoice] = useState<string | null>(null);

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

  async function generateEInvoice(invoiceId: string) {
    setGeneratingEInvoice(invoiceId);
    setMsg(null);
    try {
      const res = await api.post(`/invoices/${invoiceId}/e-invoice`, {});
      setMsg({ type: 'ok', text: `e-Invoice generated! IRN: ${res.data.irn?.slice(0, 30)}...` });
      loadInvoices(filters);
    } catch (err: any) {
      const errData = err.response?.data;
      if (errData?.missingFields) {
        setMsg({ type: 'err', text: errData.error });
      } else {
        setMsg({ type: 'err', text: `e-Invoice failed: ${errData?.error || err.message}` });
      }
    }
    setGeneratingEInvoice(null);
  }

  const statusColor = (status: string) => {
    switch (status) {
      case 'PAID': return 'bg-green-50 text-green-700 border-green-300';
      case 'PARTIAL': return 'bg-amber-50 text-amber-700 border-amber-300';
      case 'CANCELLED': return 'bg-slate-100 text-slate-500 border-slate-300';
      default: return 'bg-red-50 text-red-700 border-red-300';
    }
  };

  const progressPercent = (inv: Invoice) => {
    return inv.totalAmount > 0 ? (inv.paidAmount / inv.totalAmount) * 100 : 0;
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText size={16} />
            <span className="text-sm font-bold tracking-wide uppercase">Invoices</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Sales billing & e-invoice management</span>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { loadInvoices(filters); }} className="p-1.5 hover:bg-slate-700 transition" title="Refresh">
              <RotateCcw size={14} />
            </button>
            {!showCreateForm && (
              <button onClick={() => setShowCreateForm(true)}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1.5">
                <Plus size={13} /> NEW INVOICE
              </button>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="border-l-4 border-l-red-500 border-r border-slate-300 px-4 py-3 bg-white">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Outstanding</div>
            <div className="text-xl font-bold text-slate-900 font-mono tabular-nums">{(totalOutstanding / 100000).toFixed(1)}L</div>
          </div>
          <div className="border-l-4 border-l-blue-500 px-4 py-3 bg-white">
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">This Month Billed</div>
            <div className="text-xl font-bold text-slate-900 font-mono tabular-nums">{(thisMonthBilled / 100000).toFixed(1)}L</div>
          </div>
        </div>

        {/* Message */}
        {msg && (
          <div className={`p-3 text-xs border mt-3 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'}`}>
            {msg.text}
          </div>
        )}

        {/* Secondary Toolbar - Filters */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex gap-0">
              {['ALL', 'UNPAID', 'PARTIAL', 'PAID'].map(s => (
                <button
                  key={s}
                  onClick={() => handleFilterChange({ status: s as any })}
                  className={`px-3 py-1 text-[11px] font-bold uppercase tracking-widest border border-slate-300 ${filters.status === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 hover:bg-slate-50'} ${s === 'ALL' ? '' : '-ml-px'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <select
              value={filters.customerId || ''}
              onChange={e => handleFilterChange({ customerId: e.target.value || undefined })}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
            >
              <option value="">All Customers</option>
              {customers.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            <input
              type="date"
              value={filters.dateFrom || ''}
              onChange={e => handleFilterChange({ dateFrom: e.target.value || undefined })}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
              placeholder="From"
            />
            <input
              type="date"
              value={filters.dateTo || ''}
              onChange={e => handleFilterChange({ dateTo: e.target.value || undefined })}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
              placeholder="To"
            />
          </div>
        </div>

        {/* Create Invoice Form */}
        {showCreateForm && (
          <div className="border border-slate-300 shadow-2xl bg-white mt-3">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-sm font-bold tracking-wide uppercase">New Invoice</span>
              <button onClick={resetCreateForm} className="text-slate-400 hover:text-white"><X size={16} /></button>
            </div>

            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Customer *</label>
                <select
                  value={formCustomerId}
                  onChange={e => setFormCustomerId(e.target.value)}
                  className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  <option value="">Select Customer</option>
                  {customers.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Product</label>
                <select
                  value={formProduct}
                  onChange={e => setFormProduct(e.target.value)}
                  className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  {['DDGS', 'ETHANOL', 'LFO', 'HFO', 'RS'].map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Qty *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formQty}
                    onChange={e => setFormQty(e.target.value)}
                    placeholder="0"
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Rate *</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formRate}
                    onChange={e => setFormRate(e.target.value)}
                    placeholder="0"
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GST %</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formGst}
                    onChange={e => setFormGst(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Freight</label>
                  <input
                    type="number"
                    step="0.01"
                    value={formFreight}
                    onChange={e => setFormFreight(e.target.value)}
                    placeholder="0"
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Challan No</label>
                  <input
                    value={formChallanNo}
                    onChange={e => setFormChallanNo(e.target.value)}
                    placeholder="Optional"
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              <button
                onClick={saveInvoice}
                disabled={saving}
                className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50 w-full"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                CREATE INVOICE
              </button>
            </div>
          </div>
        )}

        {/* Invoice Table */}
        <div className="-mx-3 md:-mx-6 border-x border-slate-300 mt-3">
          <table className="w-full">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Invoice</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Customer</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Date</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Amount</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Balance</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center border-r border-slate-700">Status</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center border-r border-slate-700">Docs</th>
                <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              {invoices.length > 0 ? (
                invoices.map(inv => (
                  <>
                    <tr key={inv.id} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60 cursor-pointer" onClick={() => setExpandedId(expandedId === inv.id ? null : inv.id)}>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-semibold text-slate-900">INV-{inv.invoiceNo}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-700">{inv.customer?.name || '--'}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-600">{new Date(inv.invoiceDate).toLocaleDateString('en-IN')}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums font-semibold">{inv.totalAmount.toLocaleString('en-IN')}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums text-red-700 font-semibold">{inv.balanceAmount > 0 ? inv.balanceAmount.toLocaleString('en-IN') : '--'}</td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-center">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColor(inv.status)}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {inv.irn && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border bg-blue-50 text-blue-700 border-blue-300">IRN</span>
                          )}
                          {inv.ewbNo && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border bg-indigo-50 text-indigo-700 border-indigo-300">EWB</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-xs text-center">
                        <ChevronDown
                          size={14}
                          className={`inline text-slate-400 transition-transform ${expandedId === inv.id ? 'rotate-180' : ''}`}
                        />
                      </td>
                    </tr>

                    {/* Expanded Row */}
                    {expandedId === inv.id && (
                      <tr key={`${inv.id}-exp`}>
                        <td colSpan={8} className="bg-slate-50 border-b border-slate-200">
                          <div className="p-4 space-y-3">
                            {/* Progress Bar */}
                            <div>
                              <div className="flex justify-between text-[10px] text-slate-500 mb-1">
                                <span className="font-bold uppercase tracking-widest">Payment Progress</span>
                                <span className="font-mono">{progressPercent(inv).toFixed(0)}% -- Paid {inv.paidAmount.toLocaleString('en-IN')} / {inv.totalAmount.toLocaleString('en-IN')}</span>
                              </div>
                              <div className="w-full bg-slate-200 h-1.5">
                                <div
                                  className={`h-1.5 transition-all ${
                                    inv.status === 'PAID' ? 'bg-green-500' : inv.status === 'PARTIAL' ? 'bg-amber-500' : 'bg-red-500'
                                  }`}
                                  style={{ width: `${Math.min(progressPercent(inv), 100)}%` }}
                                />
                              </div>
                            </div>

                            {/* Line Items */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Product</div>
                                <div className="text-xs font-semibold text-slate-900">{inv.productName}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Qty</div>
                                <div className="text-xs font-semibold text-slate-900">{inv.quantity} {inv.unit}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Rate</div>
                                <div className="text-xs font-semibold text-slate-900 font-mono tabular-nums">{inv.rate.toLocaleString('en-IN')}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Base Amount</div>
                                <div className="text-xs font-semibold text-slate-900 font-mono tabular-nums">{inv.amount.toLocaleString('en-IN')}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">GST ({inv.gstPercent}%)</div>
                                <div className="text-xs font-semibold text-slate-900 font-mono tabular-nums">{inv.gstAmount.toLocaleString('en-IN')}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Freight</div>
                                <div className="text-xs font-semibold text-slate-900 font-mono tabular-nums">{inv.freightCharge.toLocaleString('en-IN')}</div>
                              </div>
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total</div>
                                <div className="text-sm font-bold text-slate-900 font-mono tabular-nums">{inv.totalAmount.toLocaleString('en-IN')}</div>
                              </div>
                              {inv.balanceAmount > 0 && (
                                <div>
                                  <div className="text-[10px] font-bold text-red-500 uppercase tracking-widest mb-0.5">Balance Due</div>
                                  <div className="text-sm font-bold text-red-700 font-mono tabular-nums">{inv.balanceAmount.toLocaleString('en-IN')}</div>
                                </div>
                              )}
                            </div>

                            {/* Actions */}
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  const token = localStorage.getItem('token');
                                  window.open(`/api/invoices/${inv.id}/pdf?token=${token}`, '_blank');
                                }}
                                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1.5"
                              >
                                <Printer size={13} /> PRINT PDF
                              </button>

                              {!inv.irn && inv.status !== 'CANCELLED' && (
                                <button
                                  onClick={() => generateEInvoice(inv.id)}
                                  disabled={generatingEInvoice === inv.id}
                                  className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1.5 disabled:opacity-50"
                                >
                                  {generatingEInvoice === inv.id ? (
                                    <Loader2 size={13} className="animate-spin" />
                                  ) : (
                                    <FileCheck size={13} />
                                  )}
                                  {generatingEInvoice === inv.id ? 'GENERATING...' : 'E-INVOICE (IRN)'}
                                </button>
                              )}
                            </div>

                            {/* e-Invoice (IRN) Status */}
                            {inv.irn && (
                              <div className={`border p-3 ${inv.irnStatus === 'CANCELLED' ? 'bg-red-50 border-red-300' : 'bg-blue-50 border-blue-300'}`}>
                                <div className={`text-xs font-bold mb-1 ${inv.irnStatus === 'CANCELLED' ? 'text-red-700' : 'text-blue-700'}`}>
                                  e-Invoice {inv.irnStatus === 'CANCELLED' ? 'Cancelled' : 'Generated'}
                                </div>
                                <div className="text-[10px] text-blue-600 space-y-0.5">
                                  <div>IRN: <span className="font-mono text-[10px] break-all">{inv.irn}</span></div>
                                  {inv.ackNo && <div>Ack No: {inv.ackNo}</div>}
                                  {inv.irnDate && <div>Date: {new Date(inv.irnDate).toLocaleDateString('en-IN')}</div>}
                                </div>
                              </div>
                            )}

                            {/* E-Way Bill Status */}
                            {inv.ewbNo && (
                              <div className="bg-indigo-50 border border-indigo-300 p-3">
                                <div className="text-xs font-bold text-indigo-700 mb-1">E-Way Bill Generated</div>
                                <div className="text-[10px] text-indigo-600 space-y-0.5">
                                  <div>EWB No: <span className="font-bold">{inv.ewbNo}</span></div>
                                  {inv.ewbDate && <div>Date: {new Date(inv.ewbDate).toLocaleDateString('en-IN')}</div>}
                                  {inv.ewbValidTill && <div>Valid Till: {new Date(inv.ewbValidTill).toLocaleDateString('en-IN')}</div>}
                                </div>
                              </div>
                            )}

                            {inv.payments && inv.payments.length > 0 && (
                              <div>
                                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Payment History</div>
                                <table className="w-full border border-slate-200">
                                  <thead>
                                    <tr className="bg-slate-100">
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-left border-r border-slate-200">Mode</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-left border-r border-slate-200">Date</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-right border-r border-slate-200">Amount</th>
                                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-1.5 text-left">Reference</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {inv.payments.map((p, i) => (
                                      <tr key={i} className="border-b border-slate-100 even:bg-slate-50/70">
                                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-semibold">{p.mode}</td>
                                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-600">{new Date(p.paymentDate).toLocaleDateString('en-IN')}</td>
                                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums font-bold">{p.amount.toLocaleString('en-IN')}</td>
                                        <td className="px-3 py-1.5 text-xs text-slate-500">{p.reference || '--'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))
              ) : (
                <tr>
                  <td colSpan={8} className="text-center py-12">
                    <span className="text-xs text-slate-400 uppercase tracking-widest">No invoices found</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
