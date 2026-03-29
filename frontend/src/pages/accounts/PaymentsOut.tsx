import React, { useState, useEffect, useCallback } from 'react';
import { X, CreditCard, FileText, Upload } from 'lucide-react';
import api from '../../services/api';

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

interface PendingPayable {
  poId: string;
  poNo: number;
  poDate: string;
  poAmount: number;
  poStatus: string;
  vendorId: string;
  vendorName: string;
  grnId: string | null;
  grnNo: number | null;
  grnDate: string | null;
  paymentTerms: string | null;
  creditDays: number;
  dueDate: string | null;
  daysOverdue: number | null;
  urgency: 'green' | 'amber' | 'red' | 'none';
  invoiceStatus: 'NO_INVOICE' | 'PENDING' | 'PARTIAL_PAID' | 'PAID';
  invoices: Array<{ id: string; vendorInvNo: string | null; netPayable: number; paidAmount: number; balanceAmount: number; status: string }>;
  totalInvoiced: number;
  totalPaid: number;
  balance: number;
  tdsApplicable: boolean;
  tdsPercent: number;
  tdsSection: string | null;
}

interface PendingSummary {
  totalPayable: number;
  overdueAmount: number;
  dueThisWeek: number;
  paidThisMonth: number;
  aging: { current: number; d1_15: number; d16_30: number; d31_60: number; d60plus: number };
  agingCount: { current: number; d1_15: number; d16_30: number; d31_60: number; d60plus: number };
}

interface OutPayment {
  id: string;
  date: string;
  payee: string;
  payeeType: 'VENDOR' | 'TRANSPORTER' | 'CASH' | 'CUSTOMER';
  amount: number;
  mode: string;
  reference: string | null;
  remarks: string | null;
  source: string;
  sourceRef: string | null;
}

interface CompletedSummary {
  totalThisMonth: number;
  vendors: { total: number; count: number };
  transporters: { total: number; count: number };
  cash: { total: number; count: number };
}

interface LedgerEntry {
  date: string; type: string; reference: string; debit: number; credit: number; runningBalance: number;
}

interface VendorLedger {
  vendor: { id: string; name: string };
  ledger: LedgerEntry[];
  currentBalance: number;
}

interface Vendor { id: string; name: string; }

interface Outstanding {
  vendor: Vendor;
  invoices: Array<{ id: string; vendorInvNo: string; netPayable: number; balanceAmount: number }>;
  totalOutstanding: number;
}

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

const fmt = (n: number) => n === 0 ? '--' : '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDec = (n: number) => n === 0 ? '--' : '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '--';
const todayStr = () => new Date().toISOString().split('T')[0];

const MODES = ['CASH', 'UPI', 'NEFT', 'RTGS', 'BANK_TRANSFER', 'CHEQUE'];
const COMP_TYPES = [
  { key: '', label: 'ALL' },
  { key: 'VENDOR', label: 'VENDOR' },
  { key: 'TRANSPORTER', label: 'TRANSPORTER' },
  { key: 'CASH', label: 'CASH' },
];

type TabKey = 'pending' | 'completed' | 'ledger' | 'outstanding';

// ═══════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════

export default function PaymentsOut() {
  const [activeTab, setActiveTab] = useState<TabKey>('pending');

  // --- Pending tab ---
  const [pendingItems, setPendingItems] = useState<PendingPayable[]>([]);
  const [pendingSummary, setPendingSummary] = useState<PendingSummary | null>(null);
  const [pendingLoading, setPendingLoading] = useState(true);

  // --- Completed tab ---
  const [completedData, setCompletedData] = useState<OutPayment[]>([]);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [completedSummary, setCompletedSummary] = useState<CompletedSummary | null>(null);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [compFilterType, setCompFilterType] = useState('');
  const [compFilterMode, setCompFilterMode] = useState('');
  const [compDateFrom, setCompDateFrom] = useState('');
  const [compDateTo, setCompDateTo] = useState('');

  // --- Ledger tab ---
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState('');
  const [vendorLedger, setVendorLedger] = useState<VendorLedger | null>(null);

  // --- Outstanding tab ---
  const [outstanding, setOutstanding] = useState<Outstanding[]>([]);

  // --- Modals ---
  const [invoiceModal, setInvoiceModal] = useState<PendingPayable | null>(null);
  const [payModal, setPayModal] = useState<{ item: PendingPayable; invoice: PendingPayable['invoices'][0] } | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ vendorInvNo: '', vendorInvDate: todayStr(), quantity: '', rate: '', gstPercent: '18', supplyType: 'INTRA_STATE' });
  const [payForm, setPayForm] = useState({ amount: '', mode: 'NEFT', reference: '', paymentDate: todayStr(), tdsDeducted: '', tdsSection: '', remarks: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // ═══════════════════════════════════════════════
  // Data fetchers
  // ═══════════════════════════════════════════════

  const fetchPending = useCallback(async () => {
    try {
      setPendingLoading(true);
      const [itemsRes, summaryRes] = await Promise.all([
        api.get<{ items: PendingPayable[] }>('/unified-payments/outgoing/pending'),
        api.get<PendingSummary>('/unified-payments/outgoing/pending-summary'),
      ]);
      setPendingItems(itemsRes.data.items || []);
      setPendingSummary(summaryRes.data);
    } catch (err) {
      console.error('Failed to fetch pending:', err);
    } finally {
      setPendingLoading(false);
    }
  }, []);

  const fetchCompleted = useCallback(async () => {
    try {
      setCompletedLoading(true);
      const params: Record<string, string> = {};
      if (compFilterType) params.type = compFilterType;
      if (compFilterMode) params.mode = compFilterMode;
      if (compDateFrom) params.from = compDateFrom;
      if (compDateTo) params.to = compDateTo;
      const [listRes, summaryRes] = await Promise.all([
        api.get<{ items: OutPayment[]; total: number }>('/unified-payments/outgoing', { params }),
        api.get<CompletedSummary>('/unified-payments/outgoing/summary'),
      ]);
      setCompletedData(listRes.data.items || []);
      setCompletedTotal(listRes.data.total || 0);
      setCompletedSummary(summaryRes.data);
    } catch (err) {
      console.error('Failed to fetch completed:', err);
    } finally {
      setCompletedLoading(false);
    }
  }, [compFilterType, compFilterMode, compDateFrom, compDateTo]);

  const fetchVendors = useCallback(async () => {
    try {
      const res = await api.get('/vendors');
      setVendors(res.data.vendors || []);
    } catch (err) {
      console.error('Failed to fetch vendors:', err);
    }
  }, []);

  const fetchLedger = useCallback(async (vendorId: string) => {
    try {
      const res = await api.get(`/vendor-payments/ledger/${vendorId}`);
      setVendorLedger(res.data);
    } catch (err) {
      console.error('Failed to fetch ledger:', err);
      setVendorLedger(null);
    }
  }, []);

  const fetchOutstanding = useCallback(async () => {
    try {
      const res = await api.get('/vendor-payments/outstanding');
      setOutstanding((res.data.outstanding || []).sort((a: Outstanding, b: Outstanding) => b.totalOutstanding - a.totalOutstanding));
    } catch (err) {
      console.error('Failed to fetch outstanding:', err);
    }
  }, []);

  // ═══════════════════════════════════════════════
  // Effects
  // ═══════════════════════════════════════════════

  useEffect(() => { fetchPending(); }, [fetchPending]);

  useEffect(() => {
    if (activeTab === 'completed') fetchCompleted();
    if (activeTab === 'ledger' && vendors.length === 0) fetchVendors();
    if (activeTab === 'outstanding') fetchOutstanding();
  }, [activeTab, fetchCompleted, fetchVendors, fetchOutstanding, vendors.length]);

  useEffect(() => {
    if (selectedVendor && activeTab === 'ledger') fetchLedger(selectedVendor);
  }, [selectedVendor, activeTab, fetchLedger]);

  // ═══════════════════════════════════════════════
  // Modal handlers
  // ═══════════════════════════════════════════════

  const openInvoiceModal = (item: PendingPayable) => {
    setInvoiceForm({
      vendorInvNo: '', vendorInvDate: todayStr(),
      quantity: '1', rate: String(item.poAmount || ''),
      gstPercent: '18', supplyType: 'INTRA_STATE',
    });
    setInvoiceModal(item);
    setError('');
  };

  const openPayModal = (item: PendingPayable) => {
    const inv = item.invoices[0];
    if (!inv) return;
    setPayForm({
      amount: String(inv.balanceAmount || ''),
      mode: 'NEFT', reference: '', paymentDate: todayStr(),
      tdsDeducted: item.tdsApplicable ? String(((inv.balanceAmount || 0) * (item.tdsPercent || 0) / 100).toFixed(2)) : '',
      tdsSection: item.tdsSection || '', remarks: '',
    });
    setPayModal({ item, invoice: inv });
    setError('');
  };

  const submitInvoice = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!invoiceModal) return;
    try {
      setSubmitting(true);
      setError('');
      await api.post('/vendor-invoices', {
        vendorId: invoiceModal.vendorId,
        poId: invoiceModal.poId,
        grnId: invoiceModal.grnId,
        vendorInvNo: invoiceForm.vendorInvNo,
        vendorInvDate: invoiceForm.vendorInvDate,
        invoiceDate: invoiceForm.vendorInvDate,
        quantity: parseFloat(invoiceForm.quantity) || 1,
        rate: parseFloat(invoiceForm.rate) || 0,
        gstPercent: parseFloat(invoiceForm.gstPercent) || 0,
        supplyType: invoiceForm.supplyType,
        status: 'APPROVED',
      });
      setInvoiceModal(null);
      fetchPending();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to create invoice';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const submitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payModal) return;
    try {
      setSubmitting(true);
      setError('');
      await api.post('/vendor-payments', {
        vendorId: payModal.item.vendorId,
        invoiceId: payModal.invoice.id,
        amount: parseFloat(payForm.amount) || 0,
        mode: payForm.mode,
        reference: payForm.reference,
        paymentDate: payForm.paymentDate,
        tdsDeducted: parseFloat(payForm.tdsDeducted) || 0,
        tdsSection: payForm.tdsSection || null,
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
  // Urgency helpers
  // ═══════════════════════════════════════════════

  const urgencyBg = (u: string) => {
    switch (u) {
      case 'red': return 'bg-red-50 text-red-700';
      case 'amber': return 'bg-amber-50 text-amber-700';
      case 'green': return 'bg-green-50 text-green-700';
      default: return 'text-slate-400';
    }
  };

  const invoiceStatusBadge = (s: string) => {
    switch (s) {
      case 'NO_INVOICE': return 'border-slate-300 bg-slate-50 text-slate-500';
      case 'PENDING': return 'border-blue-300 bg-blue-50 text-blue-700';
      case 'PARTIAL_PAID': return 'border-amber-300 bg-amber-50 text-amber-700';
      case 'PAID': return 'border-green-300 bg-green-50 text-green-700';
      default: return 'border-slate-300 bg-slate-50 text-slate-600';
    }
  };

  const typeColor = (t: string) => {
    switch (t) {
      case 'VENDOR': return 'border-blue-400 bg-blue-50 text-blue-700';
      case 'TRANSPORTER': return 'border-amber-400 bg-amber-50 text-amber-700';
      case 'CASH': return 'border-green-400 bg-green-50 text-green-700';
      default: return 'border-slate-300 bg-slate-50 text-slate-600';
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
            <CreditCard size={18} />
            <h1 className="text-sm font-bold tracking-wide uppercase">Payments Out</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Accounts Payable Workflow</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-0 -mx-3 md:-mx-6 flex gap-0">
          {([
            { key: 'pending' as const, label: 'Pending' },
            { key: 'completed' as const, label: 'Completed' },
            { key: 'ledger' as const, label: 'Vendor Ledger' },
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
                    <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Payable</div>
                      <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(pendingSummary.totalPayable)}</div>
                    </div>
                    <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-orange-500">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Overdue</div>
                      <div className="text-xl font-bold text-red-600 mt-1 font-mono tabular-nums">{fmt(pendingSummary.overdueAmount)}</div>
                    </div>
                    <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Due This Week</div>
                      <div className="text-xl font-bold text-amber-600 mt-1 font-mono tabular-nums">{fmt(pendingSummary.dueThisWeek)}</div>
                    </div>
                    <div className="bg-white px-4 py-3 border-l-4 border-l-green-500">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Paid This Month</div>
                      <div className="text-xl font-bold text-green-600 mt-1 font-mono tabular-nums">{fmt(pendingSummary.paidThisMonth)}</div>
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
                        <div className="text-[9px] text-slate-400">{b.cnt} PO{b.cnt !== 1 ? 's' : ''}</div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Pending Table */}
                <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
                  {pendingItems.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">No pending payables</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-800 text-white">
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO#</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Terms</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO Amt</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">GRN Date</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoice</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Due Date</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Days</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Balance</th>
                            <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pendingItems.map((item, i) => (
                            <tr key={item.poId} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                              <td className="px-3 py-1.5 border-r border-slate-100 font-mono font-medium text-blue-700">PO-{item.poNo}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100 font-medium text-slate-800 max-w-[180px] truncate">{item.vendorName}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100">
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{item.paymentTerms || `NET${item.creditDays}`}</span>
                              </td>
                              <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{fmt(item.poAmount)}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(item.grnDate)}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100">
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${invoiceStatusBadge(item.invoiceStatus)}`}>
                                  {item.invoiceStatus === 'NO_INVOICE' ? 'NO INV' : item.invoiceStatus.replace('_', ' ')}
                                </span>
                              </td>
                              <td className={`px-3 py-1.5 border-r border-slate-100 whitespace-nowrap ${urgencyBg(item.urgency)}`}>
                                {item.dueDate ? fmtDate(item.dueDate) : '--'}
                              </td>
                              <td className={`px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums font-bold ${item.daysOverdue !== null && item.daysOverdue > 0 ? 'text-red-600' : item.daysOverdue !== null && item.daysOverdue >= -7 ? 'text-amber-600' : 'text-green-600'}`}>
                                {item.daysOverdue !== null ? (item.daysOverdue > 0 ? `+${item.daysOverdue}` : String(item.daysOverdue)) : '--'}
                              </td>
                              <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums font-bold text-red-600">{fmt(item.balance)}</td>
                              <td className="px-3 py-1.5 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {item.invoiceStatus === 'NO_INVOICE' && item.grnId && (
                                    <button onClick={() => openInvoiceModal(item)} className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-bold uppercase hover:bg-blue-700 flex items-center gap-1" title="Upload Invoice">
                                      <Upload size={10} /> INV
                                    </button>
                                  )}
                                  {item.invoices.length > 0 && item.balance > 0 && (
                                    <button onClick={() => openPayModal(item)} className="px-2 py-0.5 bg-green-600 text-white text-[9px] font-bold uppercase hover:bg-green-700 flex items-center gap-1" title="Record Payment">
                                      <CreditCard size={10} /> PAY
                                    </button>
                                  )}
                                  {!item.grnId && (
                                    <span className="text-[9px] text-slate-400 uppercase">No GRN</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-800 text-white font-semibold">
                            <td className="px-3 py-2 text-[10px] uppercase tracking-widest" colSpan={3}>Total ({pendingItems.length} POs)</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(pendingItems.reduce((s, i) => s + i.poAmount, 0))}</td>
                            <td colSpan={4}></td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(pendingItems.reduce((s, i) => s + i.balance, 0))}</td>
                            <td></td>
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
        {/* COMPLETED TAB */}
        {/* ═══════════════════════════════════════ */}
        {activeTab === 'completed' && (
          <div>
            {/* Filter Bar */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
              <div className="flex gap-1">
                {COMP_TYPES.map(t => (
                  <button key={t.key} onClick={() => setCompFilterType(t.key)}
                    className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${compFilterType === t.key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                    {t.label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mode</label>
                <select value={compFilterMode} onChange={e => setCompFilterMode(e.target.value)}
                  className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                  <option value="">All</option>
                  {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">From</label>
                <input type="date" value={compDateFrom} onChange={e => setCompDateFrom(e.target.value)}
                  className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">To</label>
                <input type="date" value={compDateTo} onChange={e => setCompDateTo(e.target.value)}
                  className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                {(compDateFrom || compDateTo) && (
                  <button onClick={() => { setCompDateFrom(''); setCompDateTo(''); }} className="text-[10px] text-red-500 hover:text-red-700">Clear</button>
                )}
              </div>
            </div>

            {/* KPI Strip */}
            {completedSummary && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total This Month</div>
                  <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(completedSummary.totalThisMonth)}</div>
                </div>
                <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vendors</div>
                  <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(completedSummary.vendors.total)}</div>
                  <div className="text-[10px] text-slate-400">{completedSummary.vendors.count} payments</div>
                </div>
                <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Transporters</div>
                  <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(completedSummary.transporters.total)}</div>
                  <div className="text-[10px] text-slate-400">{completedSummary.transporters.count} payments</div>
                </div>
                <div className="bg-white px-4 py-3 border-l-4 border-l-green-500">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cash / Contractors</div>
                  <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(completedSummary.cash.total)}</div>
                  <div className="text-[10px] text-slate-400">{completedSummary.cash.count} vouchers</div>
                </div>
              </div>
            )}

            {/* Completed Table */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
              {completedLoading ? (
                <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">Loading...</div>
              ) : completedData.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">No outgoing payments found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-800 text-white">
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Payee</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Mode</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Reference</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ref Doc</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Remarks</th>
                      </tr>
                    </thead>
                    <tbody>
                      {completedData.map((p, i) => (
                        <tr key={p.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                          <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 whitespace-nowrap">{fmtDate(p.date)}</td>
                          <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">{p.payee}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${typeColor(p.payeeType)}`}>{p.payeeType}</span>
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 border-r border-slate-100">{fmt(p.amount)}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100">
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{p.mode}</span>
                          </td>
                          <td className="px-3 py-1.5 text-slate-500 font-mono text-[11px] border-r border-slate-100">{p.reference || '--'}</td>
                          <td className="px-3 py-1.5 text-slate-500 text-[11px] border-r border-slate-100">{p.sourceRef || '--'}</td>
                          <td className="px-3 py-1.5 text-slate-400 text-[11px] max-w-[200px] truncate">{p.remarks || '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                    {completedData.length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-800 text-white font-semibold">
                          <td className="px-3 py-2 text-[10px] uppercase tracking-widest" colSpan={3}>Total ({completedTotal} payments)</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(completedData.reduce((s, p) => s + p.amount, 0))}</td>
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
        {/* LEDGER TAB */}
        {/* ═══════════════════════════════════════ */}
        {activeTab === 'ledger' && (
          <div>
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Select Vendor</label>
              <select value={selectedVendor} onChange={e => setSelectedVendor(e.target.value)}
                className="border border-slate-300 px-2.5 py-1.5 text-xs w-full md:w-96 focus:outline-none focus:ring-1 focus:ring-slate-400">
                <option value="">Select Vendor</option>
                {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </div>

            {vendorLedger && (
              <>
                {/* Ledger KPIs */}
                <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                  <div className="border-l-4 border-l-red-500 border-r border-slate-300 bg-white px-4 py-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Invoiced</div>
                    <div className="text-xl font-bold text-slate-900 mt-1 font-mono tabular-nums">{fmtDec(vendorLedger.ledger.reduce((sum, e) => sum + (e.debit || 0), 0))}</div>
                  </div>
                  <div className="border-l-4 border-l-green-500 border-r border-slate-300 bg-white px-4 py-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total Paid</div>
                    <div className="text-xl font-bold text-slate-900 mt-1 font-mono tabular-nums">{fmtDec(vendorLedger.ledger.reduce((sum, e) => sum + (e.credit || 0), 0))}</div>
                  </div>
                  <div className="border-l-4 border-l-blue-500 bg-white px-4 py-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Current Balance</div>
                    <div className={`text-xl font-bold mt-1 font-mono tabular-nums ${vendorLedger.currentBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmtDec(vendorLedger.currentBalance)}</div>
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
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Debit</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Credit</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Running Bal</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vendorLedger.ledger.map((entry, idx) => (
                        <tr key={idx} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                          <td className="px-3 py-1.5 border-r border-slate-100">{fmtDate(entry.date)}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100">{entry.type}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100">{entry.reference}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{entry.debit > 0 ? fmtDec(entry.debit) : '--'}</td>
                          <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{entry.credit > 0 ? fmtDec(entry.credit) : '--'}</td>
                          <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-semibold ${entry.runningBalance > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmtDec(entry.runningBalance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            {selectedVendor && !vendorLedger && (
              <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
                <p className="text-xs text-slate-400 uppercase tracking-widest">No ledger data available</p>
              </div>
            )}
            {!selectedVendor && (
              <div className="text-center py-16 border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
                <p className="text-xs text-slate-400 uppercase tracking-widest">Select a vendor to view ledger</p>
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
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor Name</th>
                  <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoice Count</th>
                  <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Total Outstanding</th>
                </tr>
              </thead>
              <tbody>
                {outstanding.map((item, idx) => (
                  <tr key={idx} className="border-b border-slate-100 even:bg-slate-50/70 hover:bg-blue-50/60">
                    <td className="px-3 py-1.5 border-r border-slate-100 font-medium">{item.vendor.name}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-center">{item.invoices.length}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-red-600">{fmtDec(item.totalOutstanding)}</td>
                  </tr>
                ))}
              </tbody>
              {outstanding.length > 0 && (
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold">
                    <td className="px-3 py-2 text-[10px] uppercase tracking-widest">Total</td>
                    <td className="px-3 py-2 text-center">{outstanding.reduce((s, i) => s + i.invoices.length, 0)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtDec(outstanding.reduce((s, i) => s + i.totalOutstanding, 0))}</td>
                  </tr>
                </tfoot>
              )}
            </table>
            {outstanding.length === 0 && (
              <div className="text-center py-16 border-b border-slate-300 bg-white">
                <p className="text-xs text-slate-400 uppercase tracking-widest">No outstanding payments</p>
              </div>
            )}
          </div>
        )}

        {/* ═══════════════════════════════════════ */}
        {/* INVOICE UPLOAD MODAL */}
        {/* ═══════════════════════════════════════ */}
        {invoiceModal && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-2xl mx-4">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <FileText size={14} />
                  <span className="text-xs font-bold uppercase tracking-widest">Upload Vendor Invoice</span>
                </div>
                <button onClick={() => setInvoiceModal(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>

              {/* Context strip */}
              <div className="bg-slate-100 px-4 py-2 text-xs border-b border-slate-300 flex gap-6">
                <span><strong>PO:</strong> PO-{invoiceModal.poNo}</span>
                <span><strong>Vendor:</strong> {invoiceModal.vendorName}</span>
                <span><strong>GRN:</strong> {invoiceModal.grnNo ? `GRN-${invoiceModal.grnNo}` : '--'}</span>
                <span><strong>PO Amount:</strong> {fmt(invoiceModal.poAmount)}</span>
              </div>

              <form onSubmit={submitInvoice} className="p-4 space-y-3">
                {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5">{error}</div>}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Vendor Invoice No *</label>
                    <input type="text" value={invoiceForm.vendorInvNo} onChange={e => setInvoiceForm(f => ({ ...f, vendorInvNo: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Invoice Date *</label>
                    <input type="date" value={invoiceForm.vendorInvDate} onChange={e => setInvoiceForm(f => ({ ...f, vendorInvDate: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Quantity</label>
                    <input type="number" step="0.01" value={invoiceForm.quantity} onChange={e => setInvoiceForm(f => ({ ...f, quantity: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Rate *</label>
                    <input type="number" step="0.01" value={invoiceForm.rate} onChange={e => setInvoiceForm(f => ({ ...f, rate: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GST %</label>
                    <input type="number" step="0.01" value={invoiceForm.gstPercent} onChange={e => setInvoiceForm(f => ({ ...f, gstPercent: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Supply Type</label>
                  <select value={invoiceForm.supplyType} onChange={e => setInvoiceForm(f => ({ ...f, supplyType: e.target.value }))}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full md:w-64 focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="INTRA_STATE">Intra State (CGST + SGST)</option>
                    <option value="INTER_STATE">Inter State (IGST)</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-3 border-t border-slate-200">
                  <button type="submit" disabled={submitting}
                    className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                    {submitting ? 'SAVING...' : 'SAVE INVOICE'}
                  </button>
                  <button type="button" onClick={() => setInvoiceModal(null)}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">CANCEL</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════ */}
        {/* PAYMENT RECORDING MODAL */}
        {/* ═══════════════════════════════════════ */}
        {payModal && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-2xl mx-4">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard size={14} />
                  <span className="text-xs font-bold uppercase tracking-widest">Record Payment</span>
                </div>
                <button onClick={() => setPayModal(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>

              {/* Context strip */}
              <div className="bg-slate-100 px-4 py-2 text-xs border-b border-slate-300 flex gap-6">
                <span><strong>Vendor:</strong> {payModal.item.vendorName}</span>
                <span><strong>Invoice:</strong> {payModal.invoice.vendorInvNo || `INV-${payModal.invoice.id.slice(0, 6)}`}</span>
                <span><strong>Payable:</strong> {fmtDec(payModal.invoice.netPayable)}</span>
                <span><strong>Balance:</strong> <span className="text-red-600 font-bold">{fmtDec(payModal.invoice.balanceAmount)}</span></span>
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
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Date *</label>
                    <input type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Deducted</label>
                    <input type="number" step="0.01" value={payForm.tdsDeducted} onChange={e => setPayForm(f => ({ ...f, tdsDeducted: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Section</label>
                    <input type="text" value={payForm.tdsSection} onChange={e => setPayForm(f => ({ ...f, tdsSection: e.target.value }))}
                      placeholder="194C, 194Q..." className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                  <textarea value={payForm.remarks} onChange={e => setPayForm(f => ({ ...f, remarks: e.target.value }))}
                    rows={2} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div className="flex gap-2 pt-3 border-t border-slate-200">
                  <button type="submit" disabled={submitting}
                    className="px-4 py-1.5 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-50">
                    {submitting ? 'PROCESSING...' : 'RECORD PAYMENT'}
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
