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
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <IndianRupee size={16} />
            <span className="text-sm font-bold tracking-wide uppercase">Payments & Ledger</span>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Record payments, view ledger & aging</span>
          </div>
          <button onClick={() => { loadRecentPayments(); loadAgingReport(); }} className="p-1.5 hover:bg-slate-700 transition" title="Refresh">
            <RotateCcw size={14} />
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 flex gap-0">
          {(['record', 'ledger', 'aging'] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest whitespace-nowrap transition ${activeTab === tab ? 'border-b-2 border-blue-600 text-blue-600' : 'text-slate-500 hover:text-slate-800'}`}>
              {tab === 'record' ? 'Record Payment' : tab === 'ledger' ? 'Ledger' : 'Aging Report'}
            </button>
          ))}
        </div>

        {/* Message */}
        {msg && (
          <div className={`p-3 text-xs border mt-3 ${msg.type === 'ok' ? 'bg-green-50 text-green-700 border-green-300' : 'bg-red-50 text-red-700 border-red-300'}`}>
            {msg.text}
          </div>
        )}

        {activeTab === 'record' && (
          <div className="mt-3 space-y-3">
            {/* New Payment Form */}
            <div className="bg-white border border-slate-300">
              <div className="bg-slate-100 px-4 py-2 border-b border-slate-300">
                <span className="text-[11px] font-bold text-slate-700 uppercase tracking-widest">New Payment</span>
              </div>
              <div className="p-4 space-y-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Customer *</label>
                  <select value={selectedCustomerId} onChange={e => handleCustomerChange(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="">-- Select Customer --</option>
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Invoice *</label>
                  <select value={selectedInvoiceId} onChange={e => setSelectedInvoiceId(e.target.value)}
                    disabled={!selectedCustomerId} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400 disabled:bg-slate-100">
                    <option value="">-- Select Invoice --</option>
                    {customerInvoices.map(inv => (
                      <option key={inv.id} value={inv.id}>INV-{inv.invoiceNo} -- {inv.balanceAmount.toLocaleString('en-IN')} due</option>
                    ))}
                  </select>
                </div>
                {selectedInvoiceId && (() => {
                  const inv = customerInvoices.find(i => i.id === selectedInvoiceId);
                  return inv ? (
                    <div className="bg-slate-50 border border-slate-200 p-3 space-y-1.5 text-xs">
                      <div className="flex justify-between"><span className="text-slate-500">Invoice Total:</span><span className="font-bold font-mono tabular-nums">{inv.totalAmount.toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between"><span className="text-slate-500">Already Paid:</span><span className="font-bold font-mono tabular-nums">{inv.paidAmount.toLocaleString('en-IN')}</span></div>
                      <div className="flex justify-between border-t border-slate-200 pt-1.5"><span className="text-slate-500">Balance Due:</span><span className="font-bold text-red-700 font-mono tabular-nums">{inv.balanceAmount.toLocaleString('en-IN')}</span></div>
                    </div>
                  ) : null;
                })()}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Amount *</label>
                    <input type="number" step="0.01" value={paymentAmount} onChange={e => setPaymentAmount(e.target.value)}
                      placeholder="0" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Date *</label>
                    <input type="date" value={paymentDate} onChange={e => setPaymentDate(e.target.value)}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Mode *</label>
                  <select value={paymentMode} onChange={e => setPaymentMode(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                    {PAYMENT_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reference (UTR/Cheque No)</label>
                  <input value={paymentReference} onChange={e => setPaymentReference(e.target.value)}
                    placeholder="Optional" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Confirmed By</label>
                  <input value={paymentConfirmedBy} onChange={e => setPaymentConfirmedBy(e.target.value)}
                    placeholder="Your name" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <button onClick={recordPayment} disabled={saving || !selectedInvoiceId || !paymentAmount}
                  className="w-full px-3 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center justify-center gap-2 disabled:opacity-50">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} RECORD PAYMENT
                </button>
              </div>
            </div>

            {/* Recent Payments Table */}
            {recentPayments.length > 0 && (
              <div className="border border-slate-300 bg-white">
                <div className="bg-slate-100 px-4 py-2 border-b border-slate-300">
                  <span className="text-[11px] font-bold text-slate-700 uppercase tracking-widest">Recent Payments</span>
                </div>
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Mode / Customer</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Date</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Amount</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left">Reference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentPayments.slice(0, 5).map(p => (
                      <tr key={p.id} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                          <span className="font-semibold text-slate-900">{p.mode}</span>
                          {p.customer?.name && <span className="text-slate-500"> -- {p.customer.name}</span>}
                        </td>
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
        )}

        {activeTab === 'ledger' && (
          <div className="mt-3 space-y-3">
            {/* Customer Selector */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
              <div className="flex items-center gap-3">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Customer</label>
                <select value={ledgerCustomerId} onChange={e => handleLedgerCustomerChange(e.target.value)}
                  className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white">
                  <option value="">-- Select Customer --</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </div>

            {ledgerCustomerId && (
              <>
                {/* Ledger KPI Strip */}
                <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                  <div className="border-l-4 border-l-blue-500 border-r border-slate-300 px-4 py-3 bg-white">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Invoiced</div>
                    <div className="text-lg font-bold text-slate-900 font-mono tabular-nums">{ledgerSummary.totalInvoiced.toLocaleString('en-IN')}</div>
                  </div>
                  <div className="border-l-4 border-l-green-500 border-r border-slate-300 px-4 py-3 bg-white">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Paid</div>
                    <div className="text-lg font-bold text-slate-900 font-mono tabular-nums">{ledgerSummary.totalPaid.toLocaleString('en-IN')}</div>
                  </div>
                  <div className="border-l-4 border-l-red-500 px-4 py-3 bg-white">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Outstanding</div>
                    <div className="text-lg font-bold text-red-700 font-mono tabular-nums">{ledgerOutstanding.toLocaleString('en-IN')}</div>
                  </div>
                </div>

                {/* Ledger Timeline Table */}
                {ledgerTimeline.length > 0 ? (
                  <div className="-mx-3 md:-mx-6 border-x border-slate-300">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-slate-800 text-white">
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Type</th>
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Reference</th>
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Date</th>
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">Amount</th>
                          <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerTimeline.map((entry, i) => (
                          <tr key={i} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                            <td className="px-3 py-1.5 text-xs border-r border-slate-100">
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${entry.type === 'INVOICE' ? 'bg-red-50 text-red-700 border-red-300' : 'bg-green-50 text-green-700 border-green-300'}`}>
                                {entry.type}
                              </span>
                            </td>
                            <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-semibold text-slate-900">
                              {entry.type === 'INVOICE' ? `Invoice #${entry.ref}` : `Payment${entry.ref ? ` -- ${entry.ref}` : ''}`}
                            </td>
                            <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-slate-600">{new Date(entry.date).toLocaleDateString('en-IN')}</td>
                            <td className={`px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums font-bold ${entry.type === 'INVOICE' ? 'text-red-600' : 'text-green-600'}`}>
                              {entry.type === 'INVOICE' ? '+' : '-'}{entry.amount.toLocaleString('en-IN')}
                            </td>
                            <td className="px-3 py-1.5 text-xs text-right font-mono tabular-nums font-semibold text-slate-700">{entry.balance.toLocaleString('en-IN')}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-center py-12">
                    <span className="text-xs text-slate-400 uppercase tracking-widest">No transactions</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {activeTab === 'aging' && (
          <div className="mt-3">
            {agingRows.length > 0 ? (
              <div className="-mx-3 md:-mx-6 border-x border-slate-300">
                <table className="w-full">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-left border-r border-slate-700">Customer</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">0-7d</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">8-15d</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">16-30d</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right border-r border-slate-700">30+d</th>
                      <th className="text-[10px] uppercase tracking-widest font-semibold px-3 py-2 text-right">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agingRows.map((row, i) => (
                      <tr key={i} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 font-semibold text-slate-900">{row.customerName}</td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{row.d07 > 0 ? row.d07.toLocaleString('en-IN') : '--'}</td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums">{row.d815 > 0 ? row.d815.toLocaleString('en-IN') : '--'}</td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums text-orange-600 font-semibold">{row.d1630 > 0 ? row.d1630.toLocaleString('en-IN') : '--'}</td>
                        <td className="px-3 py-1.5 text-xs border-r border-slate-100 text-right font-mono tabular-nums text-red-600 font-semibold">{row.d30p > 0 ? row.d30p.toLocaleString('en-IN') : '--'}</td>
                        <td className="px-3 py-1.5 text-xs text-right font-mono tabular-nums font-bold text-slate-900">{row.total.toLocaleString('en-IN')}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-semibold">
                      <td className="px-3 py-2 text-[10px] uppercase tracking-widest border-r border-slate-700">Total</td>
                      <td className="px-3 py-2 text-xs text-right font-mono tabular-nums border-r border-slate-700">{agingRows.reduce((s, r) => s + r.d07, 0).toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2 text-xs text-right font-mono tabular-nums border-r border-slate-700">{agingRows.reduce((s, r) => s + r.d815, 0).toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2 text-xs text-right font-mono tabular-nums border-r border-slate-700">{agingRows.reduce((s, r) => s + r.d1630, 0).toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2 text-xs text-right font-mono tabular-nums border-r border-slate-700">{agingRows.reduce((s, r) => s + r.d30p, 0).toLocaleString('en-IN')}</td>
                      <td className="px-3 py-2 text-xs text-right font-mono tabular-nums">{agingRows.reduce((s, r) => s + r.total, 0).toLocaleString('en-IN')}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            ) : (
              <div className="text-center py-12">
                <span className="text-xs text-slate-400 uppercase tracking-widest">No overdue invoices</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
