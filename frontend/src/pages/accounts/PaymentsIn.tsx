import React, { useState, useEffect, useCallback } from 'react';
import { IndianRupee, X } from 'lucide-react';
import api from '../../services/api';

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

interface PendingReceivable {
  invoiceId: string;
  invoiceNo: number;
  invoiceDate: string;
  dueDate: string;
  daysOverdue: number;
  urgency: 'green' | 'amber' | 'red';
  customerId: string;
  customerName: string;
  productName: string;
  quantity: number;
  unit: string;
  totalAmount: number;
  paidAmount: number;
  balanceAmount: number;
  status: string;
}

interface PendingSummary {
  totalReceivable: number;
  overdueAmount: number;
  dueThisWeek: number;
  collectedThisMonth: number;
  aging: { current: number; d1_15: number; d16_30: number; d31_60: number; d60plus: number };
  agingCount: { current: number; d1_15: number; d16_30: number; d31_60: number; d60plus: number };
}

interface InPayment {
  id: string;
  paymentNo: number;
  date: string;
  payer: string;
  amount: number;
  mode: string;
  reference: string | null;
  invoiceRef: string | null;
  remarks: string | null;
}

interface ReceivedSummary {
  totalThisMonth: number;
  count: number;
  byMode: Record<string, { total: number; count: number }>;
}

interface Customer { id: string; name: string; }

interface LedgerEntry {
  date: string; type: string; ref: string; description: string; debit: number; credit: number; balance: number;
}

interface CustomerLedger {
  customer: { id: string; name: string };
  entries: LedgerEntry[];
  totalDebit: number;
  totalCredit: number;
  closingBalance: number;
}

interface OutstandingCustomer {
  customerId: string;
  customerName: string;
  buckets: Record<string, number>;
  total: number;
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

const fmt = (n: number) => n === 0 ? '--' : '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDec = (n: number) => n === 0 ? '--' : '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '--';
const todayStr = () => new Date().toISOString().split('T')[0];

const MODES = ['CASH', 'UPI', 'NEFT', 'RTGS', 'BANK_TRANSFER', 'CHEQUE'];
type TabKey = 'pending' | 'received' | 'ledger' | 'outstanding';

// ═══════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════

export default function PaymentsIn() {
  const [activeTab, setActiveTab] = useState<TabKey>('pending');

  // --- Pending ---
  const [pendingItems, setPendingItems] = useState<PendingReceivable[]>([]);
  const [pendingSummary, setPendingSummary] = useState<PendingSummary | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true);

  // --- Received ---
  const [receivedData, setReceivedData] = useState<InPayment[]>([]);
  const [receivedTotal, setReceivedTotal] = useState(0);
  const [receivedSummary, setReceivedSummary] = useState<ReceivedSummary | null>(null);
  const [receivedLoading, setReceivedLoading] = useState(false);
  const [filterCustomer, setFilterCustomer] = useState('');
  const [filterMode, setFilterMode] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // --- Ledger ---
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState('');
  const [customerLedger, setCustomerLedger] = useState<CustomerLedger | null>(null);

  // --- Outstanding ---
  const [outstanding, setOutstanding] = useState<OutstandingCustomer[]>([]);
  const [outstandingTotal, setOutstandingTotal] = useState(0);

  // --- Payment modal ---
  const [payModal, setPayModal] = useState<PendingReceivable | null>(null);
  const [payForm, setPayForm] = useState({ amount: '', mode: 'NEFT', reference: '', paymentDate: todayStr(), remarks: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // ═══════════════════════════════════════════════
  // Fetchers
  // ═══════════════════════════════════════════════

  const fetchPending = useCallback(async () => {
    try {
      setPendingLoading(true);
      const [itemsRes, summaryRes] = await Promise.all([
        api.get<{ items: PendingReceivable[] }>('/unified-payments/incoming/pending'),
        api.get<PendingSummary>('/unified-payments/incoming/pending-summary'),
      ]);
      setPendingItems(itemsRes.data.items || []);
      setPendingSummary(summaryRes.data);
    } catch (err) {
      console.error('Failed to fetch pending receivables:', err);
    } finally {
      setPendingLoading(false);
    }
  }, []);

  const fetchReceived = useCallback(async () => {
    try {
      setReceivedLoading(true);
      const params: Record<string, string> = {};
      if (filterCustomer) params.customerId = filterCustomer;
      if (filterMode) params.mode = filterMode;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;
      const [listRes, summaryRes] = await Promise.all([
        api.get<{ items: InPayment[]; total: number }>('/unified-payments/incoming', { params }),
        api.get<ReceivedSummary>('/unified-payments/incoming/summary'),
      ]);
      setReceivedData(listRes.data.items || []);
      setReceivedTotal(listRes.data.total || 0);
      setReceivedSummary(summaryRes.data);
    } catch (err) {
      console.error('Failed to fetch received:', err);
    } finally {
      setReceivedLoading(false);
    }
  }, [filterCustomer, filterMode, dateFrom, dateTo]);

  const fetchCustomers = useCallback(async () => {
    try {
      const res = await api.get('/customers', { params: { limit: 200 } });
      const list = Array.isArray(res.data) ? res.data : (res.data as { items?: Customer[] }).items || [];
      setCustomers(list);
    } catch (err) {
      console.error('Failed to fetch customers:', err);
    }
  }, []);

  const fetchLedger = useCallback(async (customerId: string) => {
    try {
      const res = await api.get(`/accounts-reports/customer-ledger/${customerId}`);
      setCustomerLedger(res.data);
    } catch (err) {
      console.error('Failed to fetch ledger:', err);
      setCustomerLedger(null);
    }
  }, []);

  const fetchOutstanding = useCallback(async () => {
    try {
      const res = await api.get('/accounts-reports/outstanding-receivables');
      const items = (res.data.customers || []).sort((a: OutstandingCustomer, b: OutstandingCustomer) => b.total - a.total);
      setOutstanding(items);
      setOutstandingTotal(res.data.grandTotal || 0);
    } catch (err) {
      console.error('Failed to fetch outstanding:', err);
    }
  }, []);

  // ═══════════════════════════════════════════════
  // Effects
  // ═══════════════════════════════════════════════

  useEffect(() => { fetchPending(); }, [fetchPending]);

  useEffect(() => {
    if (activeTab === 'received') fetchReceived();
    if (activeTab === 'ledger' && customers.length === 0) fetchCustomers();
    if (activeTab === 'outstanding') fetchOutstanding();
  }, [activeTab, fetchReceived, fetchCustomers, fetchOutstanding, customers.length]);

  useEffect(() => {
    if (selectedCustomer && activeTab === 'ledger') fetchLedger(selectedCustomer);
  }, [selectedCustomer, activeTab, fetchLedger]);

  // ═══════════════════════════════════════════════
  // Payment modal
  // ═══════════════════════════════════════════════

  const openPayModal = (item: PendingReceivable) => {
    setPayForm({ amount: String(item.balanceAmount || ''), mode: 'NEFT', reference: '', paymentDate: todayStr(), remarks: '' });
    setPayModal(item);
    setError('');
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModal) return;
    try {
      setSubmitting(true);
      setError('');
      await api.post('/payments', {
        customerId: payModal.customerId,
        invoiceId: payModal.invoiceId,
        amount: parseFloat(payForm.amount) || 0,
        mode: payForm.mode,
        reference: payForm.reference,
        paymentDate: payForm.paymentDate,
        remarks: payForm.remarks || null,
      });
      setPayModal(null);
      fetchPending();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to record payment';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // ═══════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════

  const urgencyBg = (u: string) => {
    switch (u) {
      case 'red': return 'bg-red-50 text-red-700';
      case 'amber': return 'bg-amber-50 text-amber-700';
      case 'green': return 'bg-green-50 text-green-700';
      default: return 'text-slate-400';
    }
  };

  // ═══════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <IndianRupee size={18} />
            <h1 className="text-sm font-bold tracking-wide uppercase">Payments In</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Accounts Receivable Workflow</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-0 -mx-3 md:-mx-6 flex gap-0">
          {([
            { key: 'pending' as const, label: 'Pending' },
            { key: 'received' as const, label: 'Received' },
            { key: 'ledger' as const, label: 'Customer Ledger' },
            { key: 'outstanding' as const, label: 'Outstanding' },
          ]).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 transition ${activeTab === tab.key ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
              {tab.label}
              {tab.key === 'pending' && pendingItems.length > 0 && (
                <span className="ml-1.5 text-[9px] px-1.5 py-0.5 bg-red-600 text-white font-bold">{pendingItems.length}</span>
              )}
            </button>
          ))}
        </div>

        {/* ═══════════════════════════════════════ */}
        {/* PENDING TAB */}
        {/* ═══════════════════════════════════════ */}
        {activeTab === 'pending' && (
          <div>
            {pendingLoading ? (
              <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">Loading...</div>
            ) : (
              <>
                {/* KPI Strip */}
                {pendingSummary && (
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                    <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Receivable</div>
                      <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(pendingSummary.totalReceivable)}</div>
                    </div>
                    <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Overdue</div>
                      <div className="text-xl font-bold text-red-600 mt-1 font-mono tabular-nums">{fmt(pendingSummary.overdueAmount)}</div>
                    </div>
                    <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Due This Week</div>
                      <div className="text-xl font-bold text-amber-600 mt-1 font-mono tabular-nums">{fmt(pendingSummary.dueThisWeek)}</div>
                    </div>
                    <div className="bg-white px-4 py-3 border-l-4 border-l-green-500">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Collected This Month</div>
                      <div className="text-xl font-bold text-green-600 mt-1 font-mono tabular-nums">{fmt(pendingSummary.collectedThisMonth)}</div>
                    </div>
                  </div>
                )}

                {/* Aging Buckets */}
                {pendingSummary && (
                  <div className="grid grid-cols-5 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                    {([
                      { label: 'Current', val: pendingSummary.aging.current, cnt: pendingSummary.agingCount.current, color: 'text-green-600' },
                      { label: '1-15 Days', val: pendingSummary.aging.d1_15, cnt: pendingSummary.agingCount.d1_15, color: 'text-amber-600' },
                      { label: '16-30 Days', val: pendingSummary.aging.d16_30, cnt: pendingSummary.agingCount.d16_30, color: 'text-orange-600' },
                      { label: '31-60 Days', val: pendingSummary.aging.d31_60, cnt: pendingSummary.agingCount.d31_60, color: 'text-red-600' },
                      { label: '60+ Days', val: pendingSummary.aging.d60plus, cnt: pendingSummary.agingCount.d60plus, color: 'text-red-800' },
                    ]).map((b, i) => (
                      <div key={b.label} className={`bg-white px-3 py-2 ${i < 4 ? 'border-r border-slate-300' : ''}`}>
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{b.label}</div>
                        <div className={`text-sm font-bold mt-0.5 font-mono tabular-nums ${b.color}`}>{fmt(b.val)}</div>
                        <div className="text-[9px] text-slate-400">{b.cnt} inv{b.cnt !== 1 ? 's' : ''}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Pending Table */}
                <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
                  {pendingItems.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">No pending receivables</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-800 text-white">
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Inv#</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Customer</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Product</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Total</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Paid</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Balance</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Due Date</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Days</th>
                            <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pendingItems.map((item, i) => (
                            <tr key={item.invoiceId} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                              <td className="px-3 py-1.5 border-r border-slate-100 font-mono font-medium text-blue-700">INV-{item.invoiceNo}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100 font-medium text-slate-800 max-w-[160px] truncate">{item.customerName}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{item.productName}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{fmt(item.totalAmount)}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-green-600">{fmt(item.paidAmount)}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums font-bold text-red-600">{fmt(item.balanceAmount)}</td>
                              <td className={`px-3 py-1.5 border-r border-slate-100 whitespace-nowrap ${urgencyBg(item.urgency)}`}>{fmtDate(item.dueDate)}</td>
                              <td className={`px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums font-bold ${item.daysOverdue > 0 ? 'text-red-600' : item.daysOverdue >= -7 ? 'text-amber-600' : 'text-green-600'}`}>
                                {item.daysOverdue > 0 ? `+${item.daysOverdue}` : String(item.daysOverdue)}
                              </td>
                              <td className="px-3 py-1.5 text-center">
                                <button onClick={() => openPayModal(item)} className="px-2 py-0.5 bg-green-600 text-white text-[9px] font-bold uppercase hover:bg-green-700">
                                  COLLECT
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-800 text-white font-semibold">
                            <td className="px-3 py-2 text-[10px] uppercase tracking-widest" colSpan={3}>Total ({pendingItems.length} invoices)</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(pendingItems.reduce((s, i) => s + i.totalAmount, 0))}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(pendingItems.reduce((s, i) => s + i.paidAmount, 0))}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(pendingItems.reduce((s, i) => s + i.balanceAmount, 0))}</td>
                            <td colSpan={3}></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════ */}
        {/* RECEIVED TAB */}
        {/* ═══════════════════════════════════════ */}
        {activeTab === 'received' && (
          <div>
            {/* Filter Bar */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Customer</label>
                <select value={filterCustomer} onChange={e => setFilterCustomer(e.target.value)}
                  className="ml-2 border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                  <option value="">All</option>
                  {customers.length > 0 ? customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>) : null}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mode</label>
                <select value={filterMode} onChange={e => setFilterMode(e.target.value)}
                  className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                  <option value="">All</option>
                  {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">From</label>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
                  className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">To</label>
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
                  className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                {(dateFrom || dateTo) && (
                  <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[10px] text-red-500 hover:text-red-700">Clear</button>
                )}
              </div>
            </div>

            {/* KPI Strip */}
            {receivedSummary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Received This Month</div>
                  <div className="text-xl font-bold text-green-700 mt-1 font-mono tabular-nums">{fmt(receivedSummary.totalThisMonth)}</div>
                  <div className="text-[10px] text-slate-400">{receivedSummary.count} payments</div>
                </div>
                {Object.entries(receivedSummary.byMode || {}).sort((a, b) => b[1].total - a[1].total).slice(0, 3).map(([mode, stats]) => (
                  <div key={mode} className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{mode}</div>
                    <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(stats.total)}</div>
                    <div className="text-[10px] text-slate-400">{stats.count} payments</div>
                  </div>
                ))}
              </div>
            )}

            {/* Table */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
              {receivedLoading ? (
                <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">Loading...</div>
              ) : receivedData.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">No incoming payments found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-800 text-white">
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">#</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Customer</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Mode</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Reference</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoice</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {receivedData.map((p, i) => (
                        <tr key={p.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                          <td className="px-3 py-1.5 text-slate-400 font-mono text-[11px] border-r border-slate-100">{p.paymentNo}</td>
                          <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 whitespace-nowrap">{fmtDate(p.date)}</td>
                          <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">{p.payer}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-green-700 font-medium border-r border-slate-100">{fmt(p.amount)}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100">
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{p.mode}</span>
                          </td>
                          <td className="px-3 py-1.5 text-slate-500 font-mono text-[11px] border-r border-slate-100">{p.reference || '--'}</td>
                          <td className="px-3 py-1.5 text-slate-500 text-[11px] border-r border-slate-100">{p.invoiceRef || '--'}</td>
                          <td className="px-3 py-1.5 text-slate-400 text-[11px] max-w-[200px] truncate">{p.remarks || '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                    {receivedData.length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-800 text-white font-semibold">
                          <td className="px-3 py-2 text-[10px] uppercase tracking-widest" colSpan={3}>Total ({receivedTotal} payments)</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(receivedData.reduce((s, p) => s + p.amount, 0))}</td>
                          <td colSpan={4}></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════ */}
        {/* CUSTOMER LEDGER TAB */}
        {/* ═══════════════════════════════════════ */}
        {activeTab === 'ledger' && (
          <div>
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Select Customer</label>
              <select value={selectedCustomer} onChange={e => setSelectedCustomer(e.target.value)}
                className="border border-slate-300 px-2.5 py-1.5 text-xs w-full md:w-96 focus:outline-none focus:ring-1 focus:ring-slate-400">
                <option value="">Select Customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>

            {customerLedger && (
              <>
                {/* Ledger KPIs */}
                <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                  <div className="border-l-4 border-l-red-500 border-r border-slate-300 bg-white px-4 py-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Invoiced</div>
                    <div className="text-xl font-bold text-slate-900 mt-1 font-mono tabular-nums">{fmtDec(customerLedger.totalDebit)}</div>
                  </div>
                  <div className="border-l-4 border-l-green-500 border-r border-slate-300 bg-white px-4 py-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Collected</div>
                    <div className="text-xl font-bold text-slate-900 mt-1 font-mono tabular-nums">{fmtDec(customerLedger.totalCredit)}</div>
                  </div>
                  <div className="border-l-4 border-l-blue-500 bg-white px-4 py-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Outstanding</div>
                    <div className={`text-xl font-bold mt-1 font-mono tabular-nums ${customerLedger.closingBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmtDec(customerLedger.closingBalance)}</div>
                  </div>
                </div>

                {/* Ledger Table */}
                <div className="overflow-x-auto -mx-3 md:-mx-6 border-x border-b border-slate-300">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-800 text-white">
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Reference</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Description</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Debit</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Credit</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Balance</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customerLedger.entries.map((entry, idx) => (
                        <tr key={idx} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                          <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(entry.date)}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${entry.type === 'INVOICE' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-green-300 bg-green-50 text-green-700'}`}>{entry.type}</span>
                          </td>
                          <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-[11px]">{entry.ref}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600 max-w-[200px] truncate">{entry.description}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{entry.debit > 0 ? fmtDec(entry.debit) : '--'}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{entry.credit > 0 ? fmtDec(entry.credit) : '--'}</td>
                          <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-semibold ${entry.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmtDec(entry.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {selectedCustomer && !customerLedger && (
              <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
                <p className="text-xs text-slate-400 uppercase tracking-widest">No ledger data available</p>
              </div>
            )}
            {!selectedCustomer && (
              <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
                <p className="text-xs text-slate-400 uppercase tracking-widest">Select a customer to view ledger</p>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════ */}
        {/* OUTSTANDING TAB */}
        {/* ═══════════════════════════════════════ */}
        {activeTab === 'outstanding' && (
          <div className="overflow-x-auto -mx-3 md:-mx-6 border-x border-b border-slate-300">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Customer</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">0-30 Days</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">31-60 Days</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">61-90 Days</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">90+ Days</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Total</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((item, idx) => (
                  <tr key={idx} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                    <td className="px-3 py-1.5 border-r border-slate-100 font-medium">{item.customerName}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{fmt(item.buckets['0-30'] || 0)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-amber-600">{fmt(item.buckets['31-60'] || 0)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-orange-600">{fmt(item.buckets['61-90'] || 0)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-red-600">{fmt(item.buckets['90+'] || 0)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-red-600">{fmt(item.total)}</td>
                  </tr>
                ))}
              </tbody>
              {outstanding.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold">
                    <td className="px-3 py-2 text-[10px] uppercase tracking-widest">Total</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(outstanding.reduce((s, i) => s + (i.buckets['0-30'] || 0), 0))}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(outstanding.reduce((s, i) => s + (i.buckets['31-60'] || 0), 0))}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(outstanding.reduce((s, i) => s + (i.buckets['61-90'] || 0), 0))}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(outstanding.reduce((s, i) => s + (i.buckets['90+'] || 0), 0))}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(outstandingTotal)}</td>
                  </tr>
                </tfoot>
              )}
            </table>
            {outstanding.length === 0 && (
              <div className="text-center py-16 border-b border-slate-300 bg-white">
                <p className="text-xs text-slate-400 uppercase tracking-widest">No outstanding receivables</p>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════ */}
        {/* COLLECT PAYMENT MODAL */}
        {/* ═══════════════════════════════════════ */}
        {payModal && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-2xl mx-4">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <IndianRupee size={14} />
                  <span className="text-xs font-bold uppercase tracking-widest">Collect Payment</span>
                </div>
                <button onClick={() => setPayModal(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>

              {/* Context strip */}
              <div className="bg-slate-100 px-4 py-2 text-xs border-b border-slate-300 flex gap-6">
                <span><strong>Customer:</strong> {payModal.customerName}</span>
                <span><strong>Invoice:</strong> INV-{payModal.invoiceNo}</span>
                <span><strong>Total:</strong> {fmtDec(payModal.totalAmount)}</span>
                <span><strong>Balance:</strong> <span className="text-red-600 font-bold">{fmtDec(payModal.balanceAmount)}</span></span>
              </div>

              <form onSubmit={submitPayment} className="p-4 space-y-3">
                {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5">{error}</div>}

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Amount *</label>
                    <input type="number" step="0.01" value={payForm.amount} onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Mode *</label>
                    <select value={payForm.mode} onChange={e => setPayForm(f => ({ ...f, mode: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="NEFT">NEFT</option>
                      <option value="RTGS">RTGS</option>
                      <option value="CHEQUE">Cheque</option>
                      <option value="UPI">UPI</option>
                      <option value="BANK_TRANSFER">Bank Transfer</option>
                      <option value="CASH">Cash</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reference (UTR)</label>
                    <input type="text" value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))}
                      placeholder="UTR / Cheque No" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Date *</label>
                    <input type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                    <input type="text" value={payForm.remarks} onChange={e => setPayForm(f => ({ ...f, remarks: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div className="flex gap-2 pt-3 border-t border-slate-200">
                  <button type="submit" disabled={submitting}
                    className="px-4 py-1.5 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-50">
                    {submitting ? 'PROCESSING...' : 'COLLECT PAYMENT'}
                  </button>
                  <button type="button" onClick={() => setPayModal(null)}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">CANCEL</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
