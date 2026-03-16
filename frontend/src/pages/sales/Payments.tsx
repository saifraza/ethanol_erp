import { useState, useEffect } from 'react';
import { IndianRupee, Save, Loader2, AlertTriangle } from 'lucide-react';
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
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-white max-w-5xl mx-auto">
      <div className="sticky top-0 bg-white border-b border-gray-200 z-20">
        <div className="px-4 py-4 flex items-center gap-3">
          <IndianRupee size={32} className="text-green-600" />
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-gray-900">Payments & Ledger</h1>
            <p className="text-xs md:text-sm text-gray-500">AR management & tracking</p>
          </div>
        </div>
        <div className="flex border-t border-gray-200">
          {(['record', 'ledger', 'aging'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-3 text-sm font-semibold text-center ${activeTab === tab ? 'border-b-2 border-green-600 text-green-600' : 'text-gray-600 hover:text-gray-900'}`}>
              {tab === 'record' ? 'Record Payment' : tab === 'ledger' ? 'Ledger' : 'Aging'}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {msg && (
          <div className={`rounded-lg p-3 mb-4 text-sm ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {msg.text}
          </div>
        )}

        {activeTab === 'record' && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <h3 className="text-lg font-bold text-gray-900 mb-4">New Payment</h3>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2">Customer *</label>
                  <select value={selectedCustomerId} onChange={e => handleCustomerChange(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base">
                    <option value="">— Select Customer —</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2">Invoice *</label>
                  <select value={selectedInvoiceId} onChange={e => setSelectedInvoiceId(e.target.value)}
                    disabled={!selectedCustomerId} className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base disabled:bg-gray-100">
                    <option value="">— Select Invoice —</option>
                    {customerInvoices.map(inv => (
                      <option key={inv.id} value={inv.id}>INV-{inv.invoiceNo} · ₹{inv.balanceAmount.toLocaleString('en-IN')} due</option>
                    ))}
                  </select>
                </div>
                {selectedInvoiceId && (() => {
                  const inv = customerInvoices.find(i => i.id === selectedInvoiceId);
                  return inv ? (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 space-y-2 text-sm">
                      <div className="flex justify-between"><span className="text-gray-600">Invoice Total:</span><span className="font-bold">₹{inv.totalAmount.toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between"><span className="text-gray-600">Already Paid:</span><span className="font-bold">₹{inv.paidAmount.toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between border-t border-blue-200 pt-2"><span className="text-gray-600">Balance Due:</span><span className="font-bold text-blue-700">₹{inv.balanceAmount.toLocaleString('en-IN')}</span></div>
                    </div>
                  ) : null;
                })()}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Amount *</label>
                    <input type="number" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)}
                      placeholder="0" className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base font-bold" />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1">Date *</label>
                    <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-2">Mode *</label>
                  <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base">
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Reference (UTR/Cheque No)</label>
                  <input value={paymentReference} onChange={e => setPaymentReference(e.target.value)}
                    placeholder="Optional" className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-700 mb-1">Confirmed By</label>
                  <input value={paymentConfirmedBy} onChange={e => setPaymentConfirmedBy(e.target.value)}
                    placeholder="Your name" className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base" />
                </div>
                <button onClick={recordPayment} disabled={saving || !selectedInvoiceId || !paymentAmount}
                  className="w-full py-3 bg-green-600 text-white rounded-lg font-bold text-base hover:bg-green-700 flex items-center justify-center gap-2 disabled:opacity-50 touch-target">
                  {saving ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />} Record Payment
                </button>
              </div>
            </div>
            {recentPayments.length > 0 && (
              <div className="bg-white border border-gray-200 rounded-lg p-4">
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
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <label className="block text-xs font-semibold text-gray-700 mb-2">Select Customer</label>
              <select value={ledgerCustomerId} onChange={e => handleLedgerCustomerChange(e.target.value)}
                className="w-full px-4 py-3 border border-gray-300 rounded-lg text-base">
                <option value="">— Select Customer —</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            {ledgerCustomerId && (
              <>
                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <div className="text-xs text-gray-600 mb-1">Total Invoiced</div>
                    <div className="text-lg md:text-xl font-bold text-blue-700">₹{ledgerSummary.totalInvoiced.toLocaleString('en-IN')}</div>
                  </div>
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                    <div className="text-xs text-gray-600 mb-1">Total Paid</div>
                    <div className="text-lg md:text-xl font-bold text-green-700">₹{ledgerSummary.totalPaid.toLocaleString('en-IN')}</div>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                    <div className="text-xs text-gray-600 mb-1">Outstanding</div>
                    <div className="text-lg md:text-xl font-bold text-red-700">₹{ledgerOutstanding.toLocaleString('en-IN')}</div>
                  </div>
                </div>
                {ledgerTimeline.length > 0 ? (
                  <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-2">
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
            <div className="bg-white border border-gray-200 rounded-lg overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 border-b border-gray-200">
                  <tr>
                    <th className="text-left px-4 py-3 font-bold text-gray-900">Customer</th>
                    <th className="text-right px-2 py-3 font-bold text-gray-900">0-7d</th>
                    <th className="text-right px-2 py-3 font-bold text-gray-900">8-15d</th>
                    <th className="text-right px-2 py-3 font-bold text-gray-900">16-30d</th>
                    <th className="text-right px-2 py-3 font-bold text-gray-900">30+d</th>
                    <th className="text-right px-4 py-3 font-bold text-gray-900">Total</th>
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
