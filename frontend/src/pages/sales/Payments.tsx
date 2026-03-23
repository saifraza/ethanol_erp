import { useState, useEffect } from 'react';
import { IndianRupee, Save, Loader2, AlertTriangle, RotateCcw } from 'lucide-react';
import api from '../../services/api';

interface Payment {
  id: string;
  invoiceId: string;
  paymentDate: string;
  amount: number;
  mode: string;
  reference?: string;
  confirmedBy?: string;
  customer?: { id: string; name: string };
  invoice?: { id: string; invoiceNo: number };
}

interface Invoice {
  id: string;
  invoiceNo: number;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: 'UNPAID' | 'PARTIAL' | 'PAID';
  customer?: { id: string; name: string };
}

interface Customer {
  id: string;
  name: string;
}

interface TimelineEntry {
  type: 'INVOICE' | 'PAYMENT';
  date: string;
  amount: number;
  ref: string | number | null;
  balance: number;
}

const PAYMENT_MODES = ['CASH', 'CHEQUE', 'BANK_TRANSFER', 'UPI', 'NEFT', 'RTGS'];

export default function Payments() {
  const [activeTab, setActiveTab] = useState<'record' | 'ledger' | 'aging'>('record');

  // Tab 1: Record Payment
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [customerInvoices, setCustomerInvoices] = useState<Invoice[]>([]);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState('');
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentDate, setPaymentDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [paymentMode, setPaymentMode] = useState('BANK_TRANSFER');
  const [paymentReference, setPaymentReference] = useState('');
  const [paymentConfirmedBy, setPaymentConfirmedBy] = useState('');
  const [recentPayments, setRecentPayments] = useState<Payment[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Tab 2: Ledger
  const [ledgerCustomerId, setLedgerCustomerId] = useState('');
  const [ledgerTimeline, setLedgerTimeline] = useState<TimelineEntry[]>([]);

  // Tab 3: Aging
  const [agingBuckets, setAgingBuckets] = useState<any[]>([]);

  const loadCustomers = () => {
    api.get('/customers')
      .then(r => setCustomers(r.data.customers || []))
      .catch(() => {});
  };

  const loadRecentPayments = () => {
    api.get('/payments')
      .then(r => setRecentPayments(r.data.payments || []))
      .catch(() => {});
  };

  const loadCustomerInvoices = (customerId: string) => {
    if (!customerId) { setCustomerInvoices([]); return; }
    api.get(`/invoices?customerId=${customerId}`)
      .then(r => {
        const all = r.data.invoices || [];
        setCustomerInvoices(all.filter((inv: Invoice) => inv.status !== 'PAID'));
        setSelectedInvoiceId('');
      })
      .catch(() => {});
  };

  const loadLedger = (customerId: string) => {
    if (!customerId) return;
    api.get(`/payments/ledger/${customerId}`)
      .then(r => setLedgerTimeline(r.data.timeline || []))
      .catch(() => {});
  };

  const loadAgingReport = () => {
    api.get('/payments/aging')
      .then(r => setAgingBuckets(r.data || []))
      .catch(() => {});
  };

  useEffect(() => {
    loadCustomers();
    loadRecentPayments();
    loadAgingReport();
  }, []);

  const handleCustomerChange = (customerId: string) => {
    setSelectedCustomerId(customerId);
    loadCustomerInvoices(customerId);
  };

  const handleLedgerCustomerChange = (customerId: string) => {
    setLedgerCustomerId(customerId);
    loadLedger(customerId);
  };

  const ledgerSummary = ledgerTimeline.reduce(
    (acc, entry) => {
      if (entry.type === 'INVOICE') acc.totalInvoiced += entry.amount;
      else acc.totalPaid += entry.amount;
      return acc;
    },
    { totalInvoiced: 0, totalPaid: 0 }
  );
  const ledgerOutstanding = ledgerSummary.totalInvoiced - ledgerSummary.totalPaid;

  async function recordPayment() {
    if (!selectedInvoiceId || !paymentAmount) {
      setMsg({ type: 'err', text: 'Invoice and amount required' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      await api.post('/payments', {
        customerId: selectedCustomerId,
        invoiceId: selectedInvoiceId,
        paymentDate,
        amount: parseFloat(paymentAmount),
        mode: paymentMode,
        reference: paymentReference || null,
        confirmedBy: paymentConfirmedBy || null,
      });
      setMsg({ type: 'ok', text: 'Payment recorded!' });
      setPaymentAmount('');
      setPaymentReference('');
      setPaymentConfirmedBy('');
      setSelectedInvoiceId('');
      loadRecentPayments();
      loadCustomerInvoices(selectedCustomerId);
    } catch {
      setMsg({ type: 'err', text: 'Payment recording failed' });
    }
    setSaving(false);
  }

  // Flatten aging buckets into per-customer rows
  const agingByCustomer: { [name: string]: { d07: number; d815: number; d1630: number; d30p: number; total: number } } = {};
  agingBuckets.forEach((bucket: any) => {
    (bucket.customers || []).forEach((c: any) => {
      if (!agingByCustomer[c.customerName]) agingByCustomer[c.customerName] = { d07: 0, d815: 0, d1630: 0, d30p: 0, total: 0 };
      const row = agingByCustomer[c.customerName];
      if (bucket.days === '0-7') row.d07 += c.amount;
      else if (bucket.days === '8-15') row.d815 += c.amount;
      else if (bucket.days === '16-30') row.d1630 += c.amount;
      else row.d30p += c.amount;
      row.total += c.amount;
    });
  });
  const agingRows = Object.entries(agingByCustomer).map(([name, d]) => ({ customerName: name, ...d }));

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-gradient-to-r from-green-700 to-green-800 text-white">
        <div className="max-w-7xl mx-auto px-4 py-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-xl font-bold flex items-center gap-2">
                <IndianRupee size={24} /> Payments & Ledger
              </h1>
              <p className="text-xs text-green-200 mt-1">{new Date().toLocaleDateString('en-IN', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
            </div>
            <button onClick={() => { loadRecentPayments(); loadAgingReport(); }} className="p-2 hover:bg-green-600 rounded-lg transition text-sm text-green-100" title="Refresh">
              <RotateCcw size={18} />
            </button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Tabs */}
        <div className="flex gap-2 mb-6 border-b border-gray-200 overflow-x-auto">
          {(['record', 'ledger', 'aging'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 text-sm font-semibold whitespace-nowrap transition border-b-2 ${activeTab === tab ? 'border-green-600 text-green-600' : 'border-transparent text-gray-600 hover:text-gray-900'}`}>
              {tab === 'record' ? 'Record Payment' : tab === 'ledger' ? 'Ledger' : 'Aging Report'}
            </button>
          ))}
        </div>
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.text}
          </div>
        )}

        {activeTab === 'record' && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <h3 className="text-lg font-bold text-gray-900 mb-4">New Payment</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2">Customer *</label>
                  <select value={selectedCustomerId} onChange={e => handleCustomerChange(e.target.value)}
                    className="input-field w-full text-sm">
                    <option value="">— Select Customer —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2">Invoice *</label>
                  <select value={selectedInvoiceId} onChange={e => setSelectedInvoiceId(e.target.value)}
                    disabled={!selectedCustomerId} className="input-field w-full text-sm disabled:bg-gray-100">
                    <option value="">— Select Invoice —</option>
                    {customerInvoices.map(inv => (
                      <option key={inv.id} value={inv.id}>INV-{inv.invoiceNo} · ₹{inv.balanceAmount.toLocaleString('en-IN')} due</option>
                    ))}
                  </select>
                </div>
                {selectedInvoiceId && (() => {
                  const inv = customerInvoices.find(i => i.id === selectedInvoiceId);
                  return inv ? (
                    <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-gray-600">Invoice Total:</span><span className="font-bold">₹{inv.totalAmount.toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between"><span className="text-gray-600">Already Paid:</span><span className="font-bold">₹{inv.paidAmount.toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between border-t border-green-200 pt-2"><span className="text-gray-600">Balance Due:</span><span className="font-bold text-green-700">₹{inv.balanceAmount.toLocaleString('en-IN')}</span></div>
                    </div>
                  ) : null;
                })()}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Amount *</label>
                    <input type="number" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)}
                      placeholder="0" className="input-field w-full text-sm mt-1" />
                  </div>
                  <div>
                    <label className="text-xs text-gray-500 font-medium">Date *</label>
                    <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
                      className="input-field w-full text-sm mt-1" />
                  </div>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Mode *</label>
                  <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)}
                    className="input-field w-full text-sm mt-1">
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Reference (UTR/Cheque No)</label>
                  <input value={paymentReference} onChange={e => setPaymentReference(e.target.value)}
                    placeholder="Optional" className="input-field w-full text-sm mt-1" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 font-medium">Confirmed By</label>
                  <input value={paymentConfirmedBy} onChange={e => setPaymentConfirmedBy(e.target.value)}
                    placeholder="Your name" className="input-field w-full text-sm mt-1" />
                </div>
                <button onClick={recordPayment} disabled={saving || !selectedInvoiceId || !paymentAmount}
                  className="w-full px-6 py-3 bg-green-600 text-white rounded-lg font-bold text-sm hover:bg-green-700 flex items-center justify-center gap-2 disabled:opacity-50 shadow-md transition">
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Record Payment
                </button>
              </div>
            </div>
            {recentPayments.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
                <h4 className="font-bold text-gray-900 mb-3">Recent Payments</h4>
                <div className="space-y-2">
                  {recentPayments.slice(0, 5).map(p => (
                    <div key={p.id} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{p.mode}{p.customer?.name ? ` · ${p.customer.name}` : ''}</div>
                        <div className="text-xs text-gray-500">{new Date(p.paymentDate).toLocaleDateString('en-IN')}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold text-gray-900">₹{p.amount.toLocaleString('en-IN')}</div>
                        {p.reference && <div className="text-xs text-gray-500">{p.reference}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {activeTab === 'ledger' && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4">
              <label className="block text-xs font-semibold text-gray-700 mb-2">Select Customer</label>
              <select value={ledgerCustomerId} onChange={e => handleLedgerCustomerChange(e.target.value)}
                className="input-field w-full text-sm">
                <option value="">— Select Customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {ledgerCustomerId && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
                    <div className="text-xs text-gray-600 mb-1">Total Invoiced</div>
                    <div className="text-lg md:text-xl font-bold text-blue-700">₹{ledgerSummary.totalInvoiced.toLocaleString('en-IN')}</div>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-3">
                    <div className="text-xs text-gray-600 mb-1">Total Paid</div>
                    <div className="text-lg md:text-xl font-bold text-green-700">₹{ledgerSummary.totalPaid.toLocaleString('en-IN')}</div>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3">
                    <div className="text-xs text-gray-600 mb-1">Outstanding</div>
                    <div className="text-lg md:text-xl font-bold text-red-700">₹{ledgerOutstanding.toLocaleString('en-IN')}</div>
                  </div>
                </div>
                {ledgerTimeline.length > 0 ? (
                  <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 space-y-2">
                    {ledgerTimeline.map((entry, i) => (
                      <div key={i} className="flex items-start gap-3 pb-3 border-b border-gray-100 last:border-0">
                        <div className={`w-2 h-2 rounded-full mt-2 ${entry.type === 'INVOICE' ? 'bg-red-500' : 'bg-green-500'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="font-semibold text-gray-900">
                            {entry.type === 'INVOICE' ? `Invoice #${entry.ref}` : `Payment${entry.ref ? ` — ${entry.ref}` : ''}`}
                          </div>
                          <div className="text-xs text-gray-500">{new Date(entry.date).toLocaleDateString('en-IN')}</div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          <div className={`font-bold ${entry.type === 'INVOICE' ? 'text-red-600' : 'text-green-600'}`}>
                            {entry.type === 'INVOICE' ? '+' : '-'}₹{entry.amount.toLocaleString('en-IN')}
                          </div>
                          <div className="text-xs text-gray-500 font-semibold">Bal: ₹{entry.balance.toLocaleString('en-IN')}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500"><p className="text-sm">No transactions</p></div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'aging' && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold text-gray-700 text-xs">Customer</th>
                    <th className="text-right px-2 py-3 font-semibold text-gray-700 text-xs">0-7d</th>
                    <th className="text-right px-2 py-3 font-semibold text-gray-700 text-xs">8-15d</th>
                    <th className="text-right px-2 py-3 font-semibold text-gray-700 text-xs">16-30d</th>
                    <th className="text-right px-2 py-3 font-semibold text-gray-700 text-xs">30+d</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-700 text-xs">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {agingRows.map((row, i) => (
                    <tr key={i} className="border-b border-gray-200 last:border-0">
                      <td className="px-4 py-3 font-semibold text-gray-900">{row.customerName}</td>
                      <td className="text-right px-2 py-3">{row.d07 > 0 ? `₹${row.d07.toLocaleString('en-IN')}` : '—'}</td>
                      <td className="text-right px-2 py-3">{row.d815 > 0 ? `₹${row.d815.toLocaleString('en-IN')}` : '—'}</td>
                      <td className="text-right px-2 py-3 text-orange-600 font-semibold">{row.d1630 > 0 ? `₹${row.d1630.toLocaleString('en-IN')}` : '—'}</td>
                      <td className="text-right px-2 py-3 text-red-600 font-semibold">{row.d30p > 0 ? `₹${row.d30p.toLocaleString('en-IN')}` : '—'}</td>
                      <td className="text-right px-4 py-3 font-bold text-gray-900">₹{row.total.toLocaleString('en-IN')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {agingRows.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <AlertTriangle size={48} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">No overdue invoices</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
