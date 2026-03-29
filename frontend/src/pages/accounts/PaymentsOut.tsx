import React, { useState, useEffect, useCallback } from 'react';
import { X, CreditCard, FileText, Upload, Download } from 'lucide-react';
import api from '../../services/api';

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

interface PendingPayable {
  poId: string;
  poNo: number;
  poDate: string;
  poAmount: number;
  poSubtotal: number;
  poGst: number;
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
  poId?: string | null;
  grnId?: string | null;
  invoiceFilePath?: string | null;
  invoiceAmount?: number | null;
  tdsDeducted?: number;
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

  // --- PO Pipeline ---
  const [selectedPOId, setSelectedPOId] = useState<string | null>(null);
  const [poDetail, setPODetail] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  // --- Completed tab ---
  const [completedData, setCompletedData] = useState<OutPayment[]>([]);
  const [completedTotal, setCompletedTotal] = useState(0);
  const [completedSummary, setCompletedSummary] = useState<CompletedSummary | null>(null);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [compFilterType, setCompFilterType] = useState('');
  const [compFilterMode, setCompFilterMode] = useState('');
  const [expandedPaymentId, setExpandedPaymentId] = useState<string | null>(null);
  const [compDateFrom, setCompDateFrom] = useState('');
  const [compDateTo, setCompDateTo] = useState('');

  // --- Ledger tab ---
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [selectedVendor, setSelectedVendor] = useState('');
  const [vendorLedger, setVendorLedger] = useState<VendorLedger | null>(null);

  // --- Outstanding tab ---
  const [outstanding, setOutstanding] = useState<Outstanding[]>([]);

  // --- Bank File ---
  const [selectedInvoiceIds, setSelectedInvoiceIds] = useState<Set<string>>(new Set());
  const [bankFileModal, setBankFileModal] = useState(false);
  const [bankFileForm, setBankFileForm] = useState({ paymentType: 'NEFT', debitAccount: '', payerIfsc: '', corporateId: 'MKSPIL' });
  const [bankFileLoading, setBankFileLoading] = useState(false);
  const [bankFileResult, setBankFileResult] = useState<{ batchId: string; csv: string; fileName: string; totalAmount: number; recordCount: number } | null>(null);

  // --- Modals ---
  const [invoiceModal, setInvoiceModal] = useState<PendingPayable | null>(null);
  const [payModal, setPayModal] = useState<{ item: PendingPayable; invoice: PendingPayable['invoices'][0] } | null>(null);
  const [invoiceForm, setInvoiceForm] = useState({ vendorInvNo: '', vendorInvDate: todayStr(), quantity: '', rate: '', gstPercent: '18', supplyType: 'INTRA_STATE' });
  const [invoiceFilePath, setInvoiceFilePath] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<Record<string, unknown> | null>(null);
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
    if (!selectedPOId) { setPODetail(null); return; }
    setDetailLoading(true);
    api.get(`/purchase-orders/${selectedPOId}`)
      .then(r => setPODetail(r.data))
      .catch(() => setPODetail(null))
      .finally(() => setDetailLoading(false));
  }, [selectedPOId]);

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
      quantity: '', rate: '',
      gstPercent: '', supplyType: 'INTRA_STATE',
    });
    setInvoiceFilePath('');
    setExtracted(null);
    setExtracting(false);
    setInvoiceModal(item);
    setError('');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setExtracting(true);
      setError('');
      const formData = new FormData();
      formData.append('file', file);
      const res = await api.post('/vendor-invoices/upload-extract', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 60000,
      });
      const { filePath, extracted: ext, error: extractErr } = res.data;
      setInvoiceFilePath(filePath || '');
      if (ext && !ext.raw) {
        setExtracted(ext);
        // Pre-fill form from extracted data
        setInvoiceForm(f => ({
          ...f,
          vendorInvNo: ext.invoice_number || f.vendorInvNo,
          vendorInvDate: ext.invoice_date || f.vendorInvDate,
          quantity: ext.items?.[0]?.qty ? String(ext.items[0].qty) : f.quantity,
          rate: ext.items?.[0]?.rate ? String(ext.items[0].rate) : (ext.taxable_amount ? String(ext.taxable_amount) : f.rate),
          gstPercent: ext.total_gst && ext.taxable_amount ? String(Math.round((ext.total_gst / ext.taxable_amount) * 100)) : f.gstPercent,
          supplyType: ext.supply_type === 'INTER_STATE' ? 'INTER_STATE' : 'INTRA_STATE',
        }));
      } else {
        setExtracted(null);
        if (extractErr) setError(`AI could not read invoice: ${extractErr}`);
      }
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Upload failed';
      setError(msg);
    } finally {
      setExtracting(false);
    }
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

  const handleBankFile = async (item: PendingPayable) => {
    const invoiceIds = item.invoices.filter(inv => inv.balanceAmount > 0).map(inv => inv.id);
    if (invoiceIds.length === 0) return;
    try {
      const res = await api.post('/vendor-payments/generate-bank-file', {
        invoiceIds,
        paymentType: 'NEFT',
        debitAccount: '00640110015747',
        payerIfsc: 'UBIN0800643',
        corporateId: 'MKSPIL',
      });
      const { csv, fileName } = res.data;
      // Download CSV
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to generate bank file';
      alert(msg);
    }
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
        filePath: invoiceFilePath || null,
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
  // Bank file generation
  // ═══════════════════════════════════════════════

  const toggleInvoice = (invId: string) => {
    setSelectedInvoiceIds(prev => {
      const next = new Set(prev);
      if (next.has(invId)) next.delete(invId);
      else next.add(invId);
      return next;
    });
  };

  const toggleAllInvoices = () => {
    if (selectedInvoiceIds.size === outstanding.flatMap(o => o.invoices).length) {
      setSelectedInvoiceIds(new Set());
    } else {
      setSelectedInvoiceIds(new Set(outstanding.flatMap(o => o.invoices.map(inv => inv.id))));
    }
  };

  const selectedTotal = outstanding.flatMap(o => o.invoices).filter(inv => selectedInvoiceIds.has(inv.id)).reduce((s, inv) => s + (inv.balanceAmount || 0), 0);

  const openBankFileModal = () => {
    if (selectedInvoiceIds.size === 0) return;
    setBankFileResult(null);
    setError('');
    setBankFileModal(true);
  };

  const generateBankFile = async () => {
    if (!bankFileForm.debitAccount || !bankFileForm.payerIfsc) {
      setError('Debit account and payer IFSC are required');
      return;
    }
    try {
      setBankFileLoading(true);
      setError('');
      const res = await api.post('/vendor-payments/generate-bank-file', {
        invoiceIds: Array.from(selectedInvoiceIds),
        paymentType: bankFileForm.paymentType,
        debitAccount: bankFileForm.debitAccount,
        payerIfsc: bankFileForm.payerIfsc,
        corporateId: bankFileForm.corporateId,
      });
      const data = res.data;
      setBankFileResult(data);

      // Auto-download CSV
      const blob = new Blob([data.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = data.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed to generate bank file';
      setError(msg);
    } finally {
      setBankFileLoading(false);
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
                          <React.Fragment key={item.poId}>
                            <tr className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''} ${selectedPOId === item.poId ? 'bg-blue-50' : ''}`}>
                              <td className="px-3 py-1.5 border-r border-slate-100 font-mono font-medium">
                                <button onClick={() => setSelectedPOId(selectedPOId === item.poId ? null : item.poId)} className="text-blue-700 hover:text-blue-900 hover:underline">
                                  PO-{item.poNo}
                                </button>
                              </td>
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
                                    <>
                                      <button onClick={() => handleBankFile(item)} className="px-2 py-0.5 bg-indigo-600 text-white text-[9px] font-bold uppercase hover:bg-indigo-700 flex items-center gap-1" title="Generate Bank File">
                                        <FileText size={10} /> CSV
                                      </button>
                                      <button onClick={() => openPayModal(item)} className="px-2 py-0.5 bg-green-600 text-white text-[9px] font-bold uppercase hover:bg-green-700 flex items-center gap-1" title="Confirm Payment">
                                        <CreditCard size={10} /> PAID
                                      </button>
                                    </>
                                  )}
                                  {!item.grnId && (
                                    <span className="text-[9px] text-slate-400 uppercase">No GRN</span>
                                  )}
                                </div>
                              </td>
                            </tr>
                            {/* Pipeline expansion row */}
                            {selectedPOId === item.poId && (
                              <tr>
                                <td colSpan={10} className="p-0 border-b border-slate-300 bg-slate-50">
                                  {detailLoading ? (
                                    <div className="p-4 text-center text-xs text-slate-400 uppercase tracking-widest">Loading pipeline...</div>
                                  ) : poDetail?.pipeline ? (
                                    <div className="p-4 space-y-3">
                                      {/* Pipeline Steps */}
                                      <div className="flex items-center justify-center gap-0">
                                        {([
                                          { label: 'Ordered', done: true, value: `${poDetail.pipeline.ordered.qty} qty`, sub: fmt(poDetail.pipeline.ordered.amount) },
                                          { label: 'Received', done: poDetail.pipeline.received.grnCount > 0, value: `${poDetail.pipeline.received.qty} qty`, sub: `${poDetail.pipeline.received.grnCount} GRN${poDetail.pipeline.received.grnCount !== 1 ? 's' : ''}${poDetail.pipeline.received.pending > 0 ? ` (${poDetail.pipeline.received.pending} pending)` : ''}` },
                                          { label: 'Invoiced', done: poDetail.pipeline.invoiced.count > 0, value: fmt(poDetail.pipeline.invoiced.amount), sub: `${poDetail.pipeline.invoiced.count} invoice${poDetail.pipeline.invoiced.count !== 1 ? 's' : ''}` },
                                          { label: 'Paid', done: poDetail.pipeline.paid.amount > 0, value: fmt(poDetail.pipeline.paid.amount), sub: poDetail.pipeline.paid.balance > 0 ? `Bal: ${fmt(poDetail.pipeline.paid.balance)}` : 'Settled' },
                                        ]).map((step, si) => (
                                          <React.Fragment key={step.label}>
                                            {si > 0 && <div className={`h-0.5 w-8 ${step.done ? 'bg-green-400' : 'bg-slate-300'}`} />}
                                            <div className={`border px-4 py-2 text-center min-w-[120px] ${step.done ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-white'}`}>
                                              <div className={`text-[9px] font-bold uppercase tracking-widest ${step.done ? 'text-green-700' : 'text-slate-400'}`}>{step.label}</div>
                                              <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${step.done ? 'text-green-800' : 'text-slate-300'}`}>{step.value}</div>
                                              <div className={`text-[9px] ${step.done ? 'text-green-600' : 'text-slate-300'}`}>{step.sub}</div>
                                            </div>
                                          </React.Fragment>
                                        ))}
                                      </div>

                                      {/* Documents Grid */}
                                      {/* Documents & Records */}
                                      <div className="grid grid-cols-3 gap-3 text-[10px]">
                                        {/* GRNs */}
                                        <div>
                                          <div className="font-bold text-slate-500 uppercase tracking-widest mb-1">GRNs ({(poDetail.grns || []).length})</div>
                                          <div className="max-h-40 overflow-y-auto space-y-1">
                                            {(poDetail.grns || []).map((g: any) => (
                                              <div key={g.id} className="bg-white border border-slate-200 px-2 py-1.5">
                                                <div className="flex items-center justify-between">
                                                  <span className="font-mono font-medium">GRN-{g.grnNo}</span>
                                                  <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border ${g.status === 'CONFIRMED' ? 'border-green-300 text-green-700' : 'border-slate-300 text-slate-500'}`}>{g.status}</span>
                                                </div>
                                                <div className="text-[9px] text-slate-400 mt-0.5">{fmtDate(g.grnDate)}</div>
                                              </div>
                                            ))}
                                            {(!poDetail.grns || poDetail.grns.length === 0) && <div className="text-slate-400">No GRNs</div>}
                                          </div>
                                        </div>
                                        {/* Invoices */}
                                        <div>
                                          <div className="font-bold text-slate-500 uppercase tracking-widest mb-1">Invoices ({(poDetail.vendorInvoices || []).length})</div>
                                          <div className="max-h-40 overflow-y-auto space-y-1">
                                            {(poDetail.vendorInvoices || []).map((inv: any) => (
                                              <div key={inv.id} className="bg-white border border-slate-200 px-2 py-1.5">
                                                <div className="flex items-center justify-between">
                                                  <span className="font-mono font-medium">{inv.vendorInvNo || `INV-${inv.invoiceNo}`}</span>
                                                  <div className="flex items-center gap-1">
                                                    <span className="font-mono tabular-nums">{fmt(inv.totalAmount)}</span>
                                                    <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border ${inv.status === 'PAID' ? 'border-green-300 text-green-700' : inv.status === 'PARTIAL_PAID' ? 'border-amber-300 text-amber-700' : 'border-blue-300 text-blue-700'}`}>{inv.status}</span>
                                                  </div>
                                                </div>
                                                {inv.filePath && (
                                                  <a href={`/uploads/${inv.filePath}`} target="_blank" rel="noopener noreferrer"
                                                    className="inline-flex items-center gap-1 mt-1 text-[9px] text-blue-600 hover:text-blue-800 hover:underline">
                                                    <FileText size={10} /> View Invoice PDF
                                                  </a>
                                                )}
                                              </div>
                                            ))}
                                            {(!poDetail.vendorInvoices || poDetail.vendorInvoices.length === 0) && <div className="text-slate-400">No invoices</div>}
                                          </div>
                                        </div>
                                        {/* Payments */}
                                        <div>
                                          <div className="font-bold text-slate-500 uppercase tracking-widest mb-1">Payments ({(poDetail.vendorInvoices || []).flatMap((inv: any) => inv.payments || []).length})</div>
                                          <div className="max-h-40 overflow-y-auto space-y-1">
                                            {(poDetail.vendorInvoices || []).flatMap((inv: any) => inv.payments || []).map((p: any) => (
                                              <div key={p.id} className="bg-white border border-slate-200 px-2 py-1.5">
                                                <div className="flex items-center justify-between">
                                                  <span>{fmtDate(p.paymentDate)} <span className="text-[8px] uppercase text-slate-400">{p.mode}</span></span>
                                                  <span className="font-mono tabular-nums text-green-700 font-medium">{fmt(p.amount)}</span>
                                                </div>
                                                {p.reference && <div className="text-[9px] text-slate-400 mt-0.5 font-mono">UTR: {p.reference}</div>}
                                                {p.tdsDeducted > 0 && <div className="text-[9px] text-slate-400 mt-0.5">TDS: {fmt(p.tdsDeducted)}</div>}
                                              </div>
                                            ))}
                                            {(poDetail.vendorInvoices || []).flatMap((inv: any) => inv.payments || []).length === 0 && <div className="text-slate-400">No payments</div>}
                                          </div>
                                        </div>
                                      </div>

                                      {/* Document Downloads */}
                                      <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Documents:</span>
                                        <a href={`/api/purchase-orders/${item.poId}/pdf`} target="_blank" rel="noopener noreferrer"
                                          className="px-2 py-0.5 bg-slate-700 text-white text-[9px] font-bold uppercase hover:bg-slate-800 inline-flex items-center gap-1">
                                          <FileText size={9} /> PO
                                        </a>
                                        {(poDetail.grns || []).length > 0 && (
                                          <a href={`/api/goods-receipts/${poDetail.grns[0].id}/pdf`} target="_blank" rel="noopener noreferrer"
                                            className="px-2 py-0.5 bg-slate-700 text-white text-[9px] font-bold uppercase hover:bg-slate-800 inline-flex items-center gap-1">
                                            <FileText size={9} /> GRN
                                          </a>
                                        )}
                                        {(poDetail.vendorInvoices || []).filter((inv: any) => inv.filePath).map((inv: any) => (
                                          <a key={inv.id} href={`/uploads/${inv.filePath}`} target="_blank" rel="noopener noreferrer"
                                            className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-bold uppercase hover:bg-blue-700 inline-flex items-center gap-1">
                                            <FileText size={9} /> Invoice
                                          </a>
                                        ))}
                                      </div>
                                    </div>
                                  ) : (
                                    <div className="p-4 text-center text-xs text-slate-400">No pipeline data</div>
                                  )}
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
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
                        <React.Fragment key={p.id}>
                        <tr onClick={() => setExpandedPaymentId(expandedPaymentId === p.id ? null : p.id)}
                          className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''} ${expandedPaymentId === p.id ? 'bg-blue-50' : ''}`}>
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
                        {expandedPaymentId === p.id && (
                          <tr>
                            <td colSpan={8} className="bg-slate-50 border-b border-slate-300 px-4 py-3">
                              <div className="grid grid-cols-4 gap-4 text-[10px]">
                                <div>
                                  <div className="font-bold text-slate-400 uppercase tracking-widest mb-1">Payment Details</div>
                                  <div className="space-y-0.5 text-slate-600">
                                    <div>Date: <span className="text-slate-800 font-medium">{fmtDate(p.date)}</span></div>
                                    <div>Mode: <span className="text-slate-800 font-medium">{p.mode}</span></div>
                                    <div>UTR/Ref: <span className="text-slate-800 font-mono">{p.reference || '--'}</span></div>
                                    <div>Amount: <span className="text-slate-800 font-bold font-mono">{fmt(p.amount)}</span></div>
                                    {(p.tdsDeducted || 0) > 0 && <div>TDS: <span className="text-slate-800 font-mono">{fmt(p.tdsDeducted || 0)}</span></div>}
                                  </div>
                                </div>
                                <div>
                                  <div className="font-bold text-slate-400 uppercase tracking-widest mb-1">Payee</div>
                                  <div className="space-y-0.5 text-slate-600">
                                    <div>Name: <span className="text-slate-800 font-medium">{p.payee}</span></div>
                                    <div>Type: <span className="text-slate-800">{p.payeeType}</span></div>
                                    {p.invoiceAmount && <div>Invoice Amt: <span className="text-slate-800 font-mono">{fmt(p.invoiceAmount)}</span></div>}
                                  </div>
                                </div>
                                <div>
                                  <div className="font-bold text-slate-400 uppercase tracking-widest mb-1">Source</div>
                                  <div className="space-y-0.5 text-slate-600">
                                    <div>From: <span className="text-slate-800">{p.source}</span></div>
                                    <div>Ref Doc: <span className="text-slate-800 font-mono">{p.sourceRef || '--'}</span></div>
                                  </div>
                                </div>
                                <div>
                                  <div className="font-bold text-slate-400 uppercase tracking-widest mb-1">Remarks</div>
                                  <div className="text-slate-700">{p.remarks || 'No remarks'}</div>
                                </div>
                              </div>
                              {/* Document Links */}
                              {(p.poId || p.grnId || p.invoiceFilePath) && (
                                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-200">
                                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Documents:</span>
                                  {p.poId && (
                                    <a href={`/api/purchase-orders/${p.poId}/pdf?token=${localStorage.getItem('token')}`} target="_blank" rel="noopener noreferrer"
                                      className="px-2 py-0.5 bg-slate-700 text-white text-[9px] font-bold uppercase hover:bg-slate-800 inline-flex items-center gap-1">
                                      <FileText size={9} /> PO
                                    </a>
                                  )}
                                  {p.grnId && (
                                    <a href={`/api/goods-receipts/${p.grnId}/pdf?token=${localStorage.getItem('token')}`} target="_blank" rel="noopener noreferrer"
                                      className="px-2 py-0.5 bg-slate-700 text-white text-[9px] font-bold uppercase hover:bg-slate-800 inline-flex items-center gap-1">
                                      <FileText size={9} /> GRN
                                    </a>
                                  )}
                                  {p.invoiceFilePath && (
                                    <a href={`/uploads/${p.invoiceFilePath}`} target="_blank" rel="noopener noreferrer"
                                      className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-bold uppercase hover:bg-blue-700 inline-flex items-center gap-1">
                                      <FileText size={9} /> Invoice
                                    </a>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        )}
                        </React.Fragment>
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
          <div>
            {/* Bank File Action Bar */}
            {outstanding.length > 0 && (
              <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                    {selectedInvoiceIds.size > 0 ? `${selectedInvoiceIds.size} invoices selected` : 'Select invoices for bank file'}
                  </span>
                  {selectedInvoiceIds.size > 0 && (
                    <span className="text-xs font-mono font-bold text-slate-700">{fmt(selectedTotal)}</span>
                  )}
                </div>
                <button onClick={openBankFileModal} disabled={selectedInvoiceIds.size === 0}
                  className={`px-3 py-1 text-[11px] font-medium flex items-center gap-1.5 ${selectedInvoiceIds.size > 0 ? 'bg-blue-600 text-white hover:bg-blue-700' : 'bg-slate-300 text-slate-500 cursor-not-allowed'}`}>
                  <Download size={12} /> GENERATE BANK FILE
                </button>
              </div>
            )}

            <div className="overflow-x-auto -mx-3 md:-mx-6 border-x border-b border-slate-300">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="w-8 px-2 py-2 border-r border-slate-700">
                      <input type="checkbox" onChange={toggleAllInvoices}
                        checked={outstanding.length > 0 && selectedInvoiceIds.size === outstanding.flatMap(o => o.invoices).length}
                        className="w-3 h-3 accent-blue-500" />
                    </th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoice No</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net Payable</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {outstanding.flatMap(item =>
                    item.invoices.map((inv, j) => (
                      <tr key={inv.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${selectedInvoiceIds.has(inv.id) ? 'bg-blue-50' : j % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                          <input type="checkbox" checked={selectedInvoiceIds.has(inv.id)}
                            onChange={() => toggleInvoice(inv.id)} className="w-3 h-3 accent-blue-500" />
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100 font-medium text-slate-800">{item.vendor.name}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-slate-600">{inv.vendorInvNo || `INV-${inv.id.slice(0, 6)}`}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{fmtDec(inv.netPayable)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-red-600">{fmtDec(inv.balanceAmount)}</td>
                      </tr>
                    ))
                  )}
                </tbody>
                {outstanding.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-semibold">
                      <td className="px-2 py-2"></td>
                      <td className="px-3 py-2 text-[10px] uppercase tracking-widest">Total ({outstanding.reduce((s, i) => s + i.invoices.length, 0)} invoices)</td>
                      <td className="px-3 py-2"></td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtDec(outstanding.reduce((s, i) => s + i.invoices.reduce((ss, inv) => ss + (inv.netPayable || 0), 0), 0))}</td>
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
          </div>
        )}

        {/* ═══════════════════════════════════════ */}
        {/* INVOICE UPLOAD MODAL */}
        {/* ═══════════════════════════════════════ */}
        {invoiceModal && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-3xl mx-4">
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

              <div className="p-4 space-y-3">
                {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5">{error}</div>}

                {/* Step 1: File Upload */}
                <div className="border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                  {extracting ? (
                    <div className="py-4">
                      <div className="inline-block w-5 h-5 border-2 border-blue-600 border-t-transparent animate-spin mb-2"></div>
                      <div className="text-xs text-slate-500 uppercase tracking-widest">Reading invoice with AI...</div>
                    </div>
                  ) : invoiceFilePath ? (
                    <div className="flex items-center justify-center gap-3 py-2">
                      <FileText size={16} className="text-green-600" />
                      <span className="text-xs text-green-700 font-medium">File uploaded</span>
                      <button onClick={() => { setInvoiceFilePath(''); setExtracted(null); }}
                        className="text-[10px] text-red-500 hover:text-red-700 underline">Remove</button>
                    </div>
                  ) : (
                    <label className="cursor-pointer block py-2">
                      <Upload size={20} className="mx-auto text-slate-400 mb-1" />
                      <div className="text-[11px] text-slate-500 font-medium">Drop vendor invoice PDF or image here</div>
                      <div className="text-[10px] text-slate-400 mt-0.5">PDF, JPG, PNG up to 10MB</div>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" onChange={handleFileUpload} className="hidden" />
                    </label>
                  )}
                </div>

                {/* Comparison: PO vs Extracted */}
                {extracted && (
                  <div className="border border-slate-300 bg-slate-50">
                    <div className="bg-slate-200 px-3 py-1.5 text-[10px] font-bold text-slate-600 uppercase tracking-widest">AI Extracted vs PO</div>
                    <div className="grid grid-cols-3 text-xs">
                      <div className="px-3 py-1 font-bold text-[10px] uppercase tracking-widest text-slate-400 border-b border-slate-200">Field</div>
                      <div className="px-3 py-1 font-bold text-[10px] uppercase tracking-widest text-slate-400 border-b border-l border-slate-200">PO Data</div>
                      <div className="px-3 py-1 font-bold text-[10px] uppercase tracking-widest text-slate-400 border-b border-l border-slate-200">Invoice Data</div>

                      <div className="px-3 py-1.5 border-b border-slate-200 text-slate-600">Vendor</div>
                      <div className="px-3 py-1.5 border-b border-l border-slate-200">{invoiceModal.vendorName}</div>
                      <div className={`px-3 py-1.5 border-b border-l border-slate-200 ${(extracted.vendor_name as string) && !(extracted.vendor_name as string).toLowerCase().includes(invoiceModal.vendorName.toLowerCase().split(' ')[0]) ? 'bg-amber-50 text-amber-700' : ''}`}>
                        {(extracted.vendor_name as string) || '--'}
                      </div>

                      <div className="px-3 py-1.5 border-b border-slate-200 text-slate-600">Amount</div>
                      <div className="px-3 py-1.5 border-b border-l border-slate-200 font-mono">{fmt(invoiceModal.poAmount)}</div>
                      <div className={`px-3 py-1.5 border-b border-l border-slate-200 font-mono ${(extracted.total_amount as number) && Math.abs((extracted.total_amount as number) - invoiceModal.poAmount) > 1 ? 'bg-red-50 text-red-700 font-bold' : ''}`}>
                        {(extracted.total_amount as number) ? fmt(extracted.total_amount as number) : '--'}
                      </div>

                      <div className="px-3 py-1.5 border-b border-slate-200 text-slate-600">Taxable</div>
                      <div className="px-3 py-1.5 border-b border-l border-slate-200 font-mono">{invoiceModal.poSubtotal ? fmt(invoiceModal.poSubtotal) : '--'}</div>
                      <div className={`px-3 py-1.5 border-b border-l border-slate-200 font-mono ${(extracted.taxable_amount as number) && invoiceModal.poSubtotal && Math.abs((extracted.taxable_amount as number) - invoiceModal.poSubtotal) > 1 ? 'bg-red-50 text-red-700 font-bold' : ''}`}>{(extracted.taxable_amount as number) ? fmt(extracted.taxable_amount as number) : '--'}</div>

                      <div className="px-3 py-1.5 text-slate-600">GST</div>
                      <div className="px-3 py-1.5 border-l border-slate-200 font-mono">{invoiceModal.poGst ? fmt(invoiceModal.poGst) : '--'}</div>
                      <div className="px-3 py-1.5 border-l border-slate-200 font-mono">{(extracted.total_gst as number) ? fmt(extracted.total_gst as number) : '--'}</div>
                    </div>
                  </div>
                )}

                {/* Editable form (pre-filled from AI or manual) */}
                <form onSubmit={submitInvoice} className="space-y-3">
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
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Rate / Taxable Amt *</label>
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
                  <span className="text-xs font-bold uppercase tracking-widest">Confirm Payment</span>
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
                    {submitting ? 'CONFIRMING...' : 'CONFIRM PAYMENT'}
                  </button>
                  <button type="button" onClick={() => setPayModal(null)}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">CANCEL</button>
                </div>
              </form>
            </div>
          </div>
        )}
        {/* ═══════════════════════════════════════ */}
        {/* BANK FILE GENERATION MODAL */}
        {/* ═══════════════════════════════════════ */}
        {bankFileModal && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-xl mx-4">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Download size={14} />
                  <span className="text-xs font-bold uppercase tracking-widest">Generate UBI Bank File</span>
                </div>
                <button onClick={() => setBankFileModal(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>

              {/* Summary strip */}
              <div className="bg-slate-100 px-4 py-2 text-xs border-b border-slate-300 flex gap-6">
                <span><strong>Invoices:</strong> {selectedInvoiceIds.size}</span>
                <span><strong>Total Amount:</strong> <span className="font-mono font-bold text-red-600">{fmtDec(selectedTotal)}</span></span>
              </div>

              <div className="p-4 space-y-3">
                {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5">{error}</div>}

                {bankFileResult ? (
                  <div className="space-y-3">
                    <div className="bg-green-50 border border-green-300 px-4 py-3">
                      <div className="text-[10px] font-bold text-green-800 uppercase tracking-widest">Bank File Generated</div>
                      <div className="text-xs text-green-700 mt-1">Batch: <span className="font-mono font-bold">{bankFileResult.batchId}</span></div>
                      <div className="text-xs text-green-700">Records: {bankFileResult.recordCount} | Total: {fmtDec(bankFileResult.totalAmount)}</div>
                      <div className="text-xs text-green-700 mt-1">File has been downloaded as <span className="font-mono">{bankFileResult.fileName}</span></div>
                    </div>
                    <div className="bg-amber-50 border border-amber-300 px-4 py-3">
                      <div className="text-[10px] font-bold text-amber-800 uppercase tracking-widest">Next Steps</div>
                      <ol className="text-xs text-amber-700 mt-1 list-decimal pl-4 space-y-0.5">
                        <li>Login to UBI APPA Portal (myportal.unionbankofindia.co.in)</li>
                        <li>Upload the CSV file in Transaction Portal</li>
                        <li>Complete Maker → Checker → Releaser approval</li>
                        <li>Download response file for payment confirmation</li>
                      </ol>
                    </div>
                    <button onClick={() => { setBankFileModal(false); setSelectedInvoiceIds(new Set()); setBankFileResult(null); }}
                      className="px-4 py-1.5 bg-slate-800 text-white text-[11px] font-medium hover:bg-slate-700">DONE</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Type *</label>
                        <select value={bankFileForm.paymentType} onChange={e => setBankFileForm(f => ({ ...f, paymentType: e.target.value }))}
                          className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                          <option value="NEFT">NEFT</option>
                          <option value="RTGS">RTGS</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Corporate ID</label>
                        <input type="text" value={bankFileForm.corporateId} onChange={e => setBankFileForm(f => ({ ...f, corporateId: e.target.value }))}
                          className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </div>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">MSPIL Debit Account No *</label>
                      <input type="text" value={bankFileForm.debitAccount} onChange={e => setBankFileForm(f => ({ ...f, debitAccount: e.target.value }))}
                        placeholder="Enter MSPIL bank account number"
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">MSPIL Bank IFSC *</label>
                      <input type="text" value={bankFileForm.payerIfsc} onChange={e => setBankFileForm(f => ({ ...f, payerIfsc: e.target.value.toUpperCase() }))}
                        placeholder="e.g., UBIN0532568"
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <div className="bg-slate-50 border border-slate-200 px-3 py-2 text-[10px] text-slate-500">
                      This will generate a CSV file in Union Bank APPA format. Upload it to the APPA portal to process payments. No payments are recorded in the ERP until you confirm them after bank processing.
                    </div>
                    <div className="flex gap-2 pt-3 border-t border-slate-200">
                      <button onClick={generateBankFile} disabled={bankFileLoading}
                        className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5">
                        <Download size={12} /> {bankFileLoading ? 'GENERATING...' : 'GENERATE & DOWNLOAD'}
                      </button>
                      <button onClick={() => setBankFileModal(false)}
                        className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">CANCEL</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
