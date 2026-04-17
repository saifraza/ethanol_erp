import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { X, CreditCard, FileText, Upload, Download, Mail, Scan } from 'lucide-react';
import api from '../../services/api';

// Pulls the clean UTR/bank-ref out of a free-text payment reference.
// Example input : "RTGSO-JAY BAJRANG BHUSA BHA UBINR22026041601296969"
// Returns       : { utr: "UBINR22026041601296969", prefix: "RTGSO-JAY BAJRANG BHUSA BHA" }
function parseUtr(ref: string | null | undefined): { utr: string; prefix: string } {
  if (!ref) return { utr: '', prefix: '' };
  const trimmed = ref.trim();
  const m = trimmed.match(/^(.*?)\s*([A-Z]{4}[A-Z0-9]{8,})\s*$/);
  if (m) return { utr: m[2], prefix: m[1].trim() };
  return { utr: trimmed, prefix: '' };
}

async function scanBankReceipt(paymentId: string, file: File): Promise<{ ok: boolean; extracted?: Record<string, unknown> | null; warnings?: string[]; error?: string }> {
  const fd = new FormData();
  fd.append('file', file);
  try {
    const res = await api.post<{ extracted: Record<string, unknown> | null; warnings: string[] }>(`/vendor-payments/${paymentId}/scan-bank-receipt`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 60000,
    });
    return { ok: true, extracted: res.data.extracted, warnings: res.data.warnings || [] };
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error || (err as { message?: string })?.message || 'Scan failed';
    return { ok: false, error: msg };
  }
}

async function sendPaymentAdvice(paymentId: string, payee: string, vendorEmail: string | null | undefined): Promise<{ ok: boolean; sentTo?: string; error?: string }> {
  let toEmail = (vendorEmail || '').trim();
  if (!toEmail) {
    const entered = window.prompt(`No email on file for ${payee}. Enter vendor email to send Payment Advice:`);
    if (!entered) return { ok: false, error: 'Cancelled' };
    toEmail = entered.trim();
  } else {
    if (!window.confirm(`Send Payment Advice to ${toEmail}?`)) return { ok: false, error: 'Cancelled' };
  }
  try {
    const res = await api.post<{ ok: boolean; sentTo: string }>(`/vendor-payments/${paymentId}/send-email`, { to: toEmail });
    return { ok: true, sentTo: res.data.sentTo };
  } catch (err: unknown) {
    const msg = (err as { response?: { data?: { error?: string } }; message?: string })?.response?.data?.error || (err as { message?: string })?.message || 'Send failed';
    return { ok: false, error: msg };
  }
}

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
  dealType: string;
  vendorId: string;
  vendorName: string;
  grnId: string | null;
  grnNo: number | null;
  grnDate: string | null;
  grnCount: number;
  grnTotalValue: number;
  paymentTerms: string | null;
  creditDays: number;
  dueDate: string | null;
  daysOverdue: number | null;
  urgency: 'green' | 'amber' | 'red' | 'none';
  invoiceStatus: 'NO_INVOICE' | 'PENDING' | 'PARTIAL_PAID' | 'PAID';
  paymentStatus: 'PO_APPROVED' | 'NO_GRN' | 'GRN_RECEIVED' | 'INVOICED' | 'PARTIAL_PAID' | 'PAID';
  invoices: Array<{ id: string; vendorInvNo: string | null; netPayable: number; paidAmount: number; balanceAmount: number; status: string }>;
  totalInvoiced: number;
  totalPaid: number;
  balance: number;
  tdsApplicable: boolean;
  tdsPercent: number;
  tdsSection: string | null;
  material: string | null;
  category: string | null;
  vendorBank: string | null;
  vendorAccount: string | null;
  vendorIfsc: string | null;
  vendorPhone: string | null;
  pendingCash?: number;
  pendingCashVouchers?: Array<{ id: string; voucherNo: number; amount: number; payeeName: string; date: string }>;
}

interface PendingSummary {
  totalPayable: number;
  overdueAmount: number;
  dueThisWeek: number;
  paidThisMonth: number;
  aging: { overdue: number; thisWeek: number; d7_15: number; d15_30: number; d30plus: number };
  agingCount: { overdue: number; thisWeek: number; d7_15: number; d15_30: number; d30plus: number };
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
  paymentStatus?: string;
  vendorEmail?: string | null;
  adviceSentAt?: string | null;
  adviceSentTo?: string | null;
  hasGst?: boolean | null;
  bankReceiptPath?: string | null;
  bankReceiptScannedAt?: string | null;
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
const fmtAmt = (n: number) => '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); // always show ₹0
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
  const [pendingSearch, setPendingSearch] = useState('');
  const [pendingCategory, setPendingCategory] = useState<string>('ALL');

  // Single source of truth: KPIs and table both render from this filtered list
  const filteredPending = useMemo(() => {
    const search = pendingSearch.toLowerCase();
    const FUEL_KW = ['coal', 'husk', 'bagasse', 'mustard', 'furnace', 'diesel', 'hsd', 'lfo', 'hfo', 'biomass'];
    const RAW_KW = ['maize', 'corn', 'broken rice', 'grain', 'sorghum', 'molasses'];
    const CHEM_KW = ['amylase', 'urea', 'acid', 'antifoam', 'yeast', 'chemical', 'caustic', 'soda', 'sulph', 'phosph'];
    return pendingItems
      .filter(item => {
        if (search && !`PO-${item.poNo} ${item.vendorName} ${item.material || ''}`.toLowerCase().includes(search)) return false;
        if (pendingCategory !== 'ALL') {
          const cat = (item.category || '').toUpperCase();
          const mat = (item.material || '').toLowerCase();
          const isFuel = cat === 'FUEL' || FUEL_KW.some(kw => mat.includes(kw));
          const isRaw = cat === 'RAW_MATERIAL' || RAW_KW.some(kw => mat.includes(kw));
          const isChem = cat === 'CHEMICAL' || CHEM_KW.some(kw => mat.includes(kw));
          if (pendingCategory === 'FUEL' && !isFuel) return false;
          if (pendingCategory === 'RAW_MATERIAL' && !isRaw) return false;
          if (pendingCategory === 'CHEMICAL' && !isChem) return false;
          if (pendingCategory === 'OTHER' && (isFuel || isRaw || isChem)) return false;
        }
        return true;
      })
      .sort((a, b) => {
        const aFuel = FUEL_KW.some(kw => (a.material || '').toLowerCase().includes(kw)) ? 0 : 1;
        const bFuel = FUEL_KW.some(kw => (b.material || '').toLowerCase().includes(kw)) ? 0 : 1;
        return aFuel - bFuel;
      });
  }, [pendingItems, pendingSearch, pendingCategory]);

  // --- PO Pay modal ---
  const [poPayItem, setPoPayItem] = useState<PendingPayable | null>(null);
  const [poPayAmount, setPoPayAmount] = useState('');
  const [poPayMode, setPoPayMode] = useState('NEFT');
  const [poPayIncludeGst, setPoPayIncludeGst] = useState<boolean | null>(null);
  const [poPayRef, setPoPayRef] = useState('');
  const [poPayRemarks, setPoPayRemarks] = useState('');
  const [poPaySaving, setPoPaySaving] = useState(false);
  const [bankPendingPayment, setBankPendingPayment] = useState<any>(null);
  const [bankUtrInput, setBankUtrInput] = useState('');
  const [bankConfirming, setBankConfirming] = useState(false);
  const [poPayments, setPoPayments] = useState<Array<{ id: string; paymentDate: string; amount: number; mode: string; reference: string; runningTotal: number }>>([]);

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

  // --- Outstanding tab (unified payables) ---
  const [outstanding, setOutstanding] = useState<Outstanding[]>([]);
  interface UnifiedPayable {
    id: string;
    source: 'VENDOR_INVOICE' | 'CONTRACTOR_BILL';
    partyId: string;
    partyName: string;
    partyType: 'VENDOR' | 'CONTRACTOR';
    refNo: string;
    date: string;
    dueDate: string | null;
    netPayable: number;
    paidAmount: number;
    balanceAmount: number;
    daysOverdue: number;
  }
  interface OutstandingSummary {
    totalOutstanding: number;
    vendorOutstanding: number;
    contractorOutstanding: number;
    overdueAmount: number;
    itemCount: number;
    partyCount: number;
  }
  const [unifiedItems, setUnifiedItems] = useState<UnifiedPayable[]>([]);
  const [outstandingSummary, setOutstandingSummary] = useState<OutstandingSummary | null>(null);
  const [outstandingFilter, setOutstandingFilter] = useState<'ALL' | 'VENDOR' | 'CONTRACTOR'>('ALL');

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
  const [payForm, setPayForm] = useState({ amount: '', mode: 'NEFT', reference: '', paymentDate: todayStr(), tdsDeducted: '', tdsSection: '', tdsLedgerId: '', remarks: '' });
  // Compulsory GST choice for every payment (invoice pay, direct pay, split pay) — null = not picked yet
  const [payHasGst, setPayHasGst] = useState<boolean | null>(null);

  // Scan Bank Receipt modal — upload the bank's payment confirmation (PDF/JPG) + AI extract
  const [scanTarget, setScanTarget] = useState<{ paymentId: string; payee: string; amount: number; existing?: string | null } | null>(null);
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanUploading, setScanUploading] = useState(false);
  const [scanResult, setScanResult] = useState<{ extracted: Record<string, unknown> | null; warnings: string[] } | null>(null);
  const [tdsCalc, setTdsCalc] = useState<{ shouldDeduct: boolean; rate: number; tdsAmount: number; netAmount: number; ledgerId: string | null; sectionLabel: string; reason: string } | null>(null);
  const [tdsOverride, setTdsOverride] = useState(true); // true = apply TDS, false = skip
  const [tdsLoading, setTdsLoading] = useState(false);
  const [splitMode, setSplitMode] = useState(false);
  const [splits, setSplits] = useState<Array<{ mode: string; amount: string; reference: string }>>([{ mode: 'NEFT', amount: '', reference: '' }]);
  const [directPayItem, setDirectPayItem] = useState<PendingPayable | null>(null);
  const [payStep, setPayStep] = useState<'instructions' | 'confirm'>('instructions');
  const [vendorBank, setVendorBank] = useState<{ bankName: string; bankBranch: string; bankAccount: string; bankIfsc: string } | null>(null);
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
      // Unified payables (vendor invoices + contractor bills)
      const uni = await api.get<{ items: UnifiedPayable[]; summary: OutstandingSummary }>('/unified-payments/outgoing/outstanding');
      setUnifiedItems((uni.data.items || []).sort((a, b) => b.balanceAmount - a.balanceAmount));
      setOutstandingSummary(uni.data.summary);
      // Legacy grouped vendor list (still used by bank-file flow)
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

  const openPayModal = async (item: PendingPayable) => {
    const inv = item.invoices[0];
    if (!inv) return;
    setPayForm({
      amount: String(inv.balanceAmount || ''),
      mode: 'NEFT', reference: '', paymentDate: todayStr(),
      tdsDeducted: '', tdsSection: '', tdsLedgerId: '', remarks: '',
    });
    setPayHasGst(null);
    setTdsCalc(null);
    setTdsOverride(true);
    setSplitMode(false);
    setPayStep('instructions');
    setPayModal({ item, invoice: inv });
    setError('');
    // Fetch vendor bank details + auto-calculate TDS in parallel
    const bankPromise = api.get(`/vendors/${item.vendorId}`).then(res => {
      const v = res.data as Record<string, unknown>;
      setVendorBank({
        bankName: (v.bankName as string) || '',
        bankBranch: (v.bankBranch as string) || '',
        bankAccount: (v.bankAccount as string) || '',
        bankIfsc: (v.bankIfsc as string) || '',
      });
    }).catch(() => setVendorBank(null));

    const tdsPromise = (async () => {
      setTdsLoading(true);
      try {
        const res = await api.post('/tax/calculate-tds', { vendorId: item.vendorId, amount: inv.balanceAmount || 0 });
        const calc = res.data;
        setTdsCalc(calc);
        if (calc.shouldDeduct) {
          setPayForm(f => ({
            ...f,
            tdsDeducted: String(calc.tdsAmount),
            tdsSection: calc.sectionLabel,
            tdsLedgerId: calc.ledgerId || '',
          }));
          setTdsOverride(true);
        }
      } catch { /* silent — manual entry still works */ }
      finally { setTdsLoading(false); }
    })();

    await Promise.all([bankPromise, tdsPromise]);
  };

  const [poPendingCash, setPoPendingCash] = useState(0);
  const [poPendingCashVouchers, setPoPendingCashVouchers] = useState<Array<{ voucherNo: number; amount: number }>>([]);
  const [poReceivedValue, setPoReceivedValue] = useState(0);

  // Fetch payment history for a PO (for the PO Pay modal)
  const fetchPOPayments = async (poId: string) => {
    try {
      const res = await api.get(`/purchase-orders/${poId}/payments`);
      setPoPayments(res.data.payments || []);
      setPoPendingCash(res.data.pendingCash || 0);
      setPoPendingCashVouchers(res.data.pendingCashVouchers || []);
      setPoReceivedValue(res.data.receivedValue || 0);
    } catch { setPoPayments([]); setPoPendingCash(0); setPoPendingCashVouchers([]); setPoReceivedValue(0); }
  };

  // Submit PO payment
  const submitPOPayment = async () => {
    if (!poPayItem || !poPayAmount || parseFloat(poPayAmount) <= 0) { alert('Enter a valid amount'); return; }
    // Compulsory GST choice — if the PO carries GST, user MUST pick Inclusive or Without.
    // If PO has 0 GST, payment is trivially "without GST" and we auto-send false.
    const poHasGstOnPO = (poPayItem.poGst || 0) > 0;
    if (poHasGstOnPO && poPayIncludeGst === null) {
      alert('Please select Tax Treatment: Pay Including GST or Pay Without GST');
      return;
    }
    const hasGstToSend: boolean = poHasGstOnPO ? !!poPayIncludeGst : false;
    setPoPaySaving(true);
    try {
      const res = await api.post(`/purchase-orders/${poPayItem.poId}/pay`, {
        amount: parseFloat(poPayAmount),
        mode: poPayMode,
        reference: poPayRef,
        remarks: poPayRemarks,
        hasGst: hasGstToSend,
      });

      // Cash payments create a voucher
      if (res.data.type === 'CASH_VOUCHER') {
        alert(`Cash Voucher #${res.data.voucher.voucherNo} created.\n\nCash team will see it in Cash Vouchers.\nPO balance updates after they settle it.`);
        setPoPayItem(null);
        fetchPending();
        return;
      }

      // Bank payment initiated (no UTR yet) — open payment slip as PDF in new tab
      if (res.data.type === 'BANK_INITIATED') {
        const v = res.data.vendor;
        const p = res.data.payment;
        const slipHtml = `<!DOCTYPE html><html><head><title>Payment Slip — PO-${res.data.poNo}</title>
          <style>body{font-family:Arial,sans-serif;margin:40px;color:#1e293b}
          .hdr{background:#1e293b;color:#fff;padding:12px 20px;font-size:14px;font-weight:bold;text-transform:uppercase;letter-spacing:2px}
          table{width:100%;border-collapse:collapse;margin:16px 0}td{padding:8px 12px;border:1px solid #cbd5e1;font-size:13px}
          .lbl{font-weight:bold;background:#f1f5f9;width:180px;text-transform:uppercase;font-size:10px;letter-spacing:1px}
          .amt{font-size:22px;font-weight:bold;font-family:monospace}.foot{text-align:center;margin-top:30px;font-size:10px;color:#94a3b8}
          @media print{body{margin:20px}}</style></head><body>
          <div class="hdr">Payment Slip — PO-${res.data.poNo}</div>
          <table><tr><td class="lbl">Pay To</td><td>${v?.name || 'Unknown'}</td></tr>
          <tr><td class="lbl">Amount</td><td class="amt">\u20B9${p.amount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td></tr>
          <tr><td class="lbl">Mode</td><td>${p.mode}</td></tr>
          <tr><td class="lbl">Payment #</td><td>${p.paymentNo}</td></tr>
          <tr><td class="lbl">Status</td><td style="color:#b45309;font-weight:bold">PENDING UTR</td></tr></table>
          <div class="hdr" style="font-size:11px">Beneficiary Bank Details</div>
          <table><tr><td class="lbl">Bank</td><td>${v?.bankName || 'N/A'}</td></tr>
          <tr><td class="lbl">Account No</td><td style="font-family:monospace;font-size:15px;letter-spacing:1px">${v?.bankAccount || 'N/A'}</td></tr>
          <tr><td class="lbl">IFSC Code</td><td style="font-family:monospace;font-weight:bold">${v?.bankIfsc || 'N/A'}</td></tr></table>
          <div class="foot">MSPIL Distillery ERP | Generated ${new Date().toLocaleString('en-IN')}<br>Enter UTR after bank transfer to confirm payment.</div>
          <script>window.print();</script></body></html>`;
        const slipWindow = window.open('', '_blank');
        if (slipWindow) { slipWindow.document.write(slipHtml); slipWindow.document.close(); }
        setBankPendingPayment(res.data.payment);
        fetchPOPayments(poPayItem.poId);
        setPoPayAmount('');
        setPoPayRemarks('');
        fetchPending();
        return;
      }

      // Confirmed payment (UTR was provided)
      fetchPOPayments(poPayItem.poId);
      setPoPayAmount('');
      setPoPayRef('');
      setPoPayRemarks('');
      await fetchPending();
      if (res.data.fullyPaid) {
        setPoPayItem(null);
      }
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Payment failed');
    } finally { setPoPaySaving(false); }
  };

  const openDirectPayModal = async (item: PendingPayable) => {
    // Direct payment for fuel deals without invoice
    setPayForm({
      amount: String(item.grnTotalValue || item.poAmount || ''),
      mode: 'NEFT', reference: '', paymentDate: todayStr(),
      tdsDeducted: item.tdsApplicable ? String(((item.grnTotalValue || item.poAmount) * (item.tdsPercent || 0) / 100).toFixed(2)) : '',
      tdsSection: item.tdsSection || '', remarks: `Fuel deal PO-${item.poNo}`,
    });
    setPayHasGst(null);
    setSplitMode(false);
    setSplits([{ mode: 'NEFT', amount: '', reference: '' }]);
    setPayStep('instructions');
    setDirectPayItem(item);
    setError('');
    // Fetch vendor bank details
    try {
      const res = await api.get(`/vendors/${item.vendorId}`);
      const v = res.data as Record<string, unknown>;
      setVendorBank({
        bankName: (v.bankName as string) || '',
        bankBranch: (v.bankBranch as string) || '',
        bankAccount: (v.bankAccount as string) || '',
        bankIfsc: (v.bankIfsc as string) || '',
      });
    } catch { setVendorBank(null); }
  };

  const submitDirectPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!directPayItem) return;
    if (payHasGst === null) { setError('Please select whether this payment includes GST'); return; }
    try {
      setSubmitting(true);
      setError('');
      if (splitMode) {
        // Split payment — cash + bank
        await api.post('/vendor-payments/split-payment', {
          vendorId: directPayItem.vendorId,
          invoiceId: null,
          poNo: directPayItem.poNo,
          splits: splits.filter(s => parseFloat(s.amount) > 0).map(s => ({
            mode: s.mode, amount: parseFloat(s.amount), reference: s.reference,
          })),
          paymentDate: payForm.paymentDate,
          tdsDeducted: parseFloat(payForm.tdsDeducted) || 0,
          tdsSection: payForm.tdsSection || null,
          tdsLedgerId: payForm.tdsLedgerId || null,
          hasGst: payHasGst,
        });
      } else {
        // Single payment
        await api.post('/vendor-payments', {
          vendorId: directPayItem.vendorId,
          invoiceId: null,
          amount: parseFloat(payForm.amount) || 0,
          mode: payForm.mode,
          reference: payForm.reference,
          paymentDate: payForm.paymentDate,
          tdsDeducted: parseFloat(payForm.tdsDeducted) || 0,
          tdsSection: payForm.tdsSection || null,
          tdsLedgerId: payForm.tdsLedgerId || null,
          remarks: payForm.remarks || `Fuel deal PO-${directPayItem.poNo}`,
          hasGst: payHasGst,
        });
      }
      setDirectPayItem(null);
      fetchPending();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Payment failed';
      setError(msg);
    } finally {
      setSubmitting(false);
    }
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

    // Mismatch warning: compare invoice taxable amount to PO subtotal
    const invQty = parseFloat(invoiceForm.quantity) || 1;
    const invRate = parseFloat(invoiceForm.rate) || 0;
    const invGst = parseFloat(invoiceForm.gstPercent) || 0;
    const invTaxable = invQty * invRate;
    const invTotal = invTaxable + (invTaxable * invGst / 100);
    const poAmount = invoiceModal.poAmount;
    const diffPct = poAmount > 0 ? Math.abs(invTotal - poAmount) / poAmount * 100 : 0;

    const diffAbs = Math.abs(invTotal - poAmount);
    if (diffAbs > 10 && !confirm(
      `Invoice total (\u20B9${invTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}) differs from PO amount (\u20B9${poAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}) by \u20B9${diffAbs.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${diffPct.toFixed(1)}%).\n\nAre you sure you want to save this invoice?`
    )) {
      return;
    }

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
    if (payHasGst === null) { setError('Please select whether this payment includes GST'); return; }
    try {
      setSubmitting(true);
      setError('');

      if (splitMode) {
        // Split payment — multiple modes
        await api.post('/vendor-payments/split-payment', {
          vendorId: payModal.item.vendorId,
          invoiceId: payModal.invoice.id,
          poNo: payModal.item.poNo,
          splits: splits.filter(s => parseFloat(s.amount) > 0).map(s => ({
            mode: s.mode, amount: parseFloat(s.amount), reference: s.reference,
          })),
          paymentDate: payForm.paymentDate,
          tdsDeducted: parseFloat(payForm.tdsDeducted) || 0,
          tdsSection: payForm.tdsSection || null,
          tdsLedgerId: payForm.tdsLedgerId || null,
          hasGst: payHasGst,
        });
      } else {
        // Single payment
        await api.post('/vendor-payments', {
          vendorId: payModal.item.vendorId,
          invoiceId: payModal.invoice.id,
          amount: parseFloat(payForm.amount) || 0,
          mode: payForm.mode,
          reference: payForm.reference,
          paymentDate: payForm.paymentDate,
          tdsDeducted: parseFloat(payForm.tdsDeducted) || 0,
          tdsSection: payForm.tdsSection || null,
          tdsLedgerId: payForm.tdsLedgerId || null,
          remarks: payForm.remarks || null,
          hasGst: payHasGst,
        });
      }
      setPayModal(null);
      setSplitMode(false);
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
                {/* KPI Strip — derived from filteredPending so they always match the table */}
                {(() => {
                  // KPIs use filteredPending (defined at component scope) so search/category
                  // filters are reflected. Rows with daysOverdue=null (no GRN, table shows "--")
                  // are excluded from time-based buckets and shown separately.
                  const totalPayable = filteredPending.reduce((s, it) => s + (it.balance || 0), 0);
                  const overdueAmount = filteredPending
                    .filter(it => it.daysOverdue !== null && (it.daysOverdue ?? 0) > 0)
                    .reduce((s, it) => s + (it.balance || 0), 0);
                  const dueThisWeek = filteredPending
                    .filter(it => {
                      if (it.daysOverdue === null) return false;
                      const d = it.daysOverdue ?? 0;
                      return d <= 0 && d >= -7;
                    })
                    .reduce((s, it) => s + (it.balance || 0), 0);
                  const buckets = {
                    overdue:  { val: 0, cnt: 0 },
                    thisWeek: { val: 0, cnt: 0 },
                    d7_15:    { val: 0, cnt: 0 },
                    d15_30:   { val: 0, cnt: 0 },
                    d30plus:  { val: 0, cnt: 0 },
                    noGrn:    { val: 0, cnt: 0 },
                  };
                  for (const it of filteredPending) {
                    const bal = it.balance || 0;
                    if (it.daysOverdue === null) { buckets.noGrn.val += bal; buckets.noGrn.cnt++; continue; }
                    const d = it.daysOverdue ?? 0;
                    if (d > 0)         { buckets.overdue.val  += bal; buckets.overdue.cnt++; }
                    else if (d >= -7)  { buckets.thisWeek.val += bal; buckets.thisWeek.cnt++; }
                    else if (d >= -15) { buckets.d7_15.val    += bal; buckets.d7_15.cnt++; }
                    else if (d >= -30) { buckets.d15_30.val   += bal; buckets.d15_30.cnt++; }
                    else               { buckets.d30plus.val  += bal; buckets.d30plus.cnt++; }
                  }
                  return (
                  <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                    <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Payable</div>
                      <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(totalPayable)}</div>
                    </div>
                    <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-orange-500">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Overdue</div>
                      <div className="text-xl font-bold text-red-600 mt-1 font-mono tabular-nums">{fmt(overdueAmount)}</div>
                    </div>
                    <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Due This Week</div>
                      <div className="text-xl font-bold text-amber-600 mt-1 font-mono tabular-nums">{fmt(dueThisWeek)}</div>
                    </div>
                    <div className="bg-white px-4 py-3 border-l-4 border-l-green-500">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Paid This Month</div>
                      <div className="text-xl font-bold text-green-600 mt-1 font-mono tabular-nums">{fmt(pendingSummary?.paidThisMonth || 0)}</div>
                    </div>
                  </div>

                  {/* Aging Buckets — also derived from filteredPending */}
                  <div className="grid grid-cols-6 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                    {([
                      { label: 'Overdue', val: buckets.overdue.val, cnt: buckets.overdue.cnt, color: 'text-red-700' },
                      { label: 'This Week', val: buckets.thisWeek.val, cnt: buckets.thisWeek.cnt, color: 'text-amber-600' },
                      { label: 'In 7-15 Days', val: buckets.d7_15.val, cnt: buckets.d7_15.cnt, color: 'text-orange-500' },
                      { label: 'In 15-30 Days', val: buckets.d15_30.val, cnt: buckets.d15_30.cnt, color: 'text-blue-600' },
                      { label: '30+ Days', val: buckets.d30plus.val, cnt: buckets.d30plus.cnt, color: 'text-green-600' },
                      { label: 'No GRN', val: buckets.noGrn.val, cnt: buckets.noGrn.cnt, color: 'text-slate-500' },
                    ]).map((b, i) => (
                      <div key={b.label} className={`bg-white px-3 py-2 ${i < 5 ? 'border-r border-slate-300' : ''}`}>
                        <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{b.label}</div>
                        <div className={`text-sm font-bold mt-0.5 font-mono tabular-nums ${b.color}`}>{fmt(b.val)}</div>
                        <div className="text-[9px] text-slate-400">{b.cnt} PO{b.cnt !== 1 ? 's' : ''}</div>
                      </div>
                    ))}
                  </div>
                  </>
                  );
                })()}

                {/* Search + Category Filter */}
                <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-100 px-4 py-2 flex items-center gap-3 flex-wrap">
                  <input value={pendingSearch} onChange={e => setPendingSearch(e.target.value)} placeholder="Search PO#, vendor, material..."
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white" />
                  {['ALL', 'FUEL', 'RAW_MATERIAL', 'CHEMICAL', 'OTHER'].map(cat => (
                    <button key={cat} onClick={() => setPendingCategory(cat)}
                      className={`px-2 py-1 text-[10px] font-bold uppercase ${pendingCategory === cat ? 'bg-slate-800 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                      {cat.replace('_', ' ')}
                    </button>
                  ))}
                </div>

                {/* Pending Table — same filteredPending used by KPIs above */}
                {(() => {
                  const filtered = filteredPending;
                  return (
                <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
                  {filtered.length === 0 ? (
                    <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">{pendingSearch || pendingCategory !== 'ALL' ? 'No matching POs' : 'No pending payables'}</div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-800 text-white">
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PO#</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Terms</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Payable</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoiced</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Paid</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700" title="Cash issued to team but not yet settled">Cash Out</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Balance</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                            <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Due Date</th>
                            <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Days</th>
                            <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filtered.map((item, i) => (
                          <React.Fragment key={item.poId}>
                            <tr className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''} ${selectedPOId === item.poId ? 'bg-blue-50' : ''}`}>
                              <td className="px-3 py-1.5 border-r border-slate-100 font-mono font-medium">
                                <button onClick={() => setSelectedPOId(selectedPOId === item.poId ? null : item.poId)} className="text-blue-700 hover:text-blue-900 hover:underline">
                                  {item.dealType === 'CONTRACTOR' ? `BILL-${item.poNo}` : `PO-${item.poNo}`}
                                </button>
                                {item.dealType === 'CONTRACTOR' && <span className="ml-1 text-[8px] font-bold uppercase px-1 py-0.5 border border-violet-300 bg-violet-50 text-violet-700">CONTRACTOR</span>}
                              </td>
                              <td className="px-3 py-1.5 border-r border-slate-100 font-medium text-slate-800 max-w-[180px] truncate">{item.vendorName}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100">
                                <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{item.paymentTerms || `NET${item.creditDays}`}</span>
                              </td>
                              <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">
                                {fmt(item.dealType === 'OPEN' ? item.grnTotalValue : item.poAmount)}
                                {item.dealType === 'OPEN' && <div className="text-[8px] text-slate-400">GRN value</div>}
                              </td>
                              <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{fmtAmt(item.totalInvoiced)}</td>
                              <td className={`px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums ${item.totalPaid > 0 ? 'text-green-700 font-medium' : 'text-slate-400'}`}>{fmtAmt(item.totalPaid)}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">
                                {(item.pendingCash || 0) > 0 ? (
                                  <div className="flex flex-col items-end gap-0.5">
                                    <span className="text-yellow-700 font-medium">{fmtAmt(item.pendingCash || 0)}</span>
                                    <span className="text-[8px] font-bold uppercase px-1 py-0.5 border border-yellow-400 bg-yellow-50 text-yellow-700"
                                      title={(item.pendingCashVouchers || []).map(v => `CV#${v.voucherNo} ${v.payeeName} ₹${v.amount.toLocaleString('en-IN')}`).join('\n')}>
                                      {(item.pendingCashVouchers || []).length} CV
                                    </span>
                                  </div>
                                ) : <span className="text-slate-300">--</span>}
                              </td>
                              <td className={`px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums font-bold ${item.balance > 0 ? 'text-red-600' : 'text-green-600'}`}>{fmtAmt(item.balance)}</td>
                              <td className="px-3 py-1.5 border-r border-slate-100">
                                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                                  item.paymentStatus === 'PO_APPROVED' ? 'border-slate-400 bg-slate-100 text-slate-600' :
                                  item.paymentStatus === 'NO_GRN' ? 'border-slate-300 bg-slate-50 text-slate-500' :
                                  item.paymentStatus === 'GRN_RECEIVED' ? 'border-amber-400 bg-amber-50 text-amber-700' :
                                  item.paymentStatus === 'INVOICED' ? 'border-blue-400 bg-blue-50 text-blue-700' :
                                  item.paymentStatus === 'PARTIAL_PAID' ? 'border-orange-400 bg-orange-50 text-orange-700' :
                                  'border-green-400 bg-green-50 text-green-700'
                                }`}>
                                  {item.paymentStatus === 'PO_APPROVED' ? 'NOT DELIVERED' :
                                   item.paymentStatus === 'NO_GRN' ? 'NO GRN' :
                                   item.paymentStatus === 'GRN_RECEIVED' ? 'AWAITING INV' :
                                   item.paymentStatus === 'INVOICED' ? 'AWAITING PAY' :
                                   item.paymentStatus === 'PARTIAL_PAID' ? 'PARTIAL' :
                                   'PAID'}
                                </span>
                              </td>
                              <td className={`px-3 py-1.5 border-r border-slate-100 whitespace-nowrap ${urgencyBg(item.urgency)}`}>
                                {item.dueDate ? fmtDate(item.dueDate) : '--'}
                              </td>
                              <td className={`px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums font-bold ${item.daysOverdue !== null && item.daysOverdue > 0 ? 'text-red-600' : item.daysOverdue !== null && item.daysOverdue >= -7 ? 'text-amber-600' : 'text-green-600'}`}>
                                {item.daysOverdue !== null ? (item.daysOverdue > 0 ? `+${item.daysOverdue}` : String(item.daysOverdue)) : '--'}
                              </td>
                              <td className="px-3 py-1.5 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {/* INV button — show when GRN exists and no invoice yet */}
                                  {item.invoiceStatus === 'NO_INVOICE' && item.grnCount > 0 && (
                                    <button onClick={() => openInvoiceModal(item)} className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-bold uppercase hover:bg-blue-700 flex items-center gap-1" title="Upload Invoice">
                                      <Upload size={10} /> INV
                                    </button>
                                  )}
                                  {/* PAY button — show when invoiced OR for fuel deals with GRNs (direct payment) */}
                                  {item.invoices.length > 0 && item.balance > 0 && (
                                    <>
                                      <button onClick={() => handleBankFile(item)} className="px-2 py-0.5 bg-indigo-600 text-white text-[9px] font-bold uppercase hover:bg-indigo-700 flex items-center gap-1" title="Generate Bank File">
                                        <FileText size={10} /> CSV
                                      </button>
                                      <button onClick={() => openPayModal(item)} className="px-2 py-0.5 bg-green-600 text-white text-[9px] font-bold uppercase hover:bg-green-700 flex items-center gap-1" title="Record Payment">
                                        <CreditCard size={10} /> PAY
                                      </button>
                                    </>
                                  )}
                                  {/* Direct PAY against PO — running account (after GRN) OR advance (before delivery) */}
                                  {(() => {
                                    const isAdvance = /ADVANCE|PREPAY/i.test(item.paymentTerms || '');
                                    const canRunningPay = item.grnCount > 0 && item.invoices.length === 0 && item.balance >= 1;
                                    const canAdvancePay = item.grnCount === 0 && item.invoices.length === 0 && isAdvance;
                                    if (canRunningPay || canAdvancePay) {
                                      return (
                                        <button onClick={() => { setPoPayItem(item); setPoPayAmount(canAdvancePay ? String(item.poAmount || '') : ''); setPoPayMode('NEFT'); setPoPayRef(''); setPoPayRemarks(canAdvancePay ? 'Advance payment' : ''); setPoPayIncludeGst(null); setBankPendingPayment(null); fetchPOPayments(item.poId); }}
                                          className="px-2 py-0.5 bg-green-600 text-white text-[9px] font-bold uppercase hover:bg-green-700 flex items-center gap-1" title={canAdvancePay ? 'Pay in advance' : 'Pay against PO'}>
                                          <CreditCard size={10} /> {canAdvancePay ? 'ADV PAY' : 'PAY'}
                                        </button>
                                      );
                                    }
                                    if (item.grnCount === 0) return <span className="text-[9px] text-slate-400 uppercase">No GRN</span>;
                                    return null;
                                  })()}
                                </div>
                              </td>
                            </tr>
                            {/* Pipeline expansion row */}
                            {selectedPOId === item.poId && (
                              <tr>
                                <td colSpan={12} className="p-0 border-b border-slate-300 bg-slate-50">
                                  {detailLoading ? (
                                    <div className="p-4 text-center text-xs text-slate-400 uppercase tracking-widest">Loading pipeline...</div>
                                  ) : poDetail?.pipeline ? (
                                    <div className="p-4 space-y-3">
                                      {/* Pipeline Steps */}
                                      <div className="flex items-center justify-center gap-0">
                                        {([
                                          { label: 'Ordered', done: true, value: fmt(poDetail.pipeline.ordered.amount), sub: `${poDetail.pipeline.ordered.qty} qty`, mismatch: false },
                                          { label: 'Received', done: poDetail.pipeline.received.grnCount > 0, value: fmt(poDetail.pipeline.received.amount || 0), sub: `${poDetail.pipeline.received.grnCount} GRN${poDetail.pipeline.received.grnCount !== 1 ? 's' : ''} | ${poDetail.pipeline.received.qty} qty`, mismatch: false },
                                          { label: 'Invoiced', done: poDetail.pipeline.invoiced.count > 0, value: fmt(poDetail.pipeline.invoiced.amount), sub: `${poDetail.pipeline.invoiced.count} invoice${poDetail.pipeline.invoiced.count !== 1 ? 's' : ''}`, mismatch: poDetail.pipeline.invoiced.amount > 0 && poDetail.pipeline.ordered.amount > 0 && Math.abs(poDetail.pipeline.invoiced.amount - poDetail.pipeline.ordered.amount) > 10 },
                                          { label: 'Paid', done: poDetail.pipeline.paid.amount > 0, value: fmt(poDetail.pipeline.paid.amount), sub: poDetail.pipeline.paid.pendingCash > 0 ? `+ ${fmt(poDetail.pipeline.paid.pendingCash)} pending cash` : poDetail.pipeline.paid.amount === 0 ? 'Unpaid' : poDetail.pipeline.paid.balance > 0 ? `Bal: ${fmt(poDetail.pipeline.paid.balance)}` : 'Settled', mismatch: false },
                                        ]).map((step, si) => (
                                          <React.Fragment key={step.label}>
                                            {si > 0 && <div className={`h-0.5 w-8 ${step.mismatch ? 'bg-red-400' : step.done ? 'bg-green-400' : 'bg-slate-300'}`} />}
                                            <div className={`border px-4 py-2 text-center min-w-[120px] ${step.mismatch ? 'border-red-300 bg-red-50' : step.done ? 'border-green-300 bg-green-50' : 'border-slate-200 bg-white'}`}>
                                              <div className={`text-[9px] font-bold uppercase tracking-widest ${step.mismatch ? 'text-red-700' : step.done ? 'text-green-700' : 'text-slate-400'}`}>
                                                {step.label}{step.mismatch ? ' MISMATCH' : ''}
                                              </div>
                                              <div className={`text-sm font-bold font-mono tabular-nums mt-0.5 ${step.mismatch ? 'text-red-800' : step.done ? 'text-green-800' : 'text-slate-300'}`}>{step.value}</div>
                                              <div className={`text-[9px] ${step.mismatch ? 'text-red-600' : step.done ? 'text-green-600' : 'text-slate-300'}`}>{step.sub}</div>
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
                                              <a key={g.id} href={`/api/goods-receipts/${g.id}/pdf?token=${localStorage.getItem('token')}`} target="_blank" rel="noopener noreferrer" className="block bg-white border border-slate-200 px-2 py-1.5 hover:bg-blue-50 hover:border-blue-300 cursor-pointer" title="Open GRN PDF">
                                                <div className="flex items-center justify-between">
                                                  <span className="font-mono font-medium text-blue-700 inline-flex items-center gap-1"><FileText size={10} /> GRN-{g.grnNo}</span>
                                                  <span className={`text-[8px] font-bold uppercase px-1 py-0.5 border ${g.status === 'CONFIRMED' ? 'border-green-300 text-green-700' : 'border-slate-300 text-slate-500'}`}>{g.status}</span>
                                                </div>
                                                <div className="flex items-center justify-between mt-0.5">
                                                  <span className="text-[9px] text-slate-400">{fmtDate(g.grnDate)}</span>
                                                  <span className="text-[9px] font-mono tabular-nums text-slate-600">{g.totalQty ? `${Number(g.totalQty).toLocaleString('en-IN')} qty` : ''}{g.totalAmount ? ` | ${fmt(g.totalAmount)}` : ''}</span>
                                                </div>
                                              </a>
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
                                          {(() => {
                                            const invPayments = (poDetail.vendorInvoices || []).flatMap((inv: any) => inv.payments || []);
                                            const directPays = poDetail.pipeline?.paid?.directPayments || [];
                                            const pendingCVs = poDetail.pipeline?.paid?.pendingCashVouchers || [];
                                            const allPayments = [...invPayments, ...directPays];
                                            const vendorEmailForPO = (poDetail.vendor as { email?: string | null } | undefined)?.email || null;
                                            const vendorNameForPO = (poDetail.vendor as { name?: string } | undefined)?.name || 'Vendor';
                                            return <>
                                              <div className="font-bold text-slate-500 uppercase tracking-widest mb-1">Payments ({allPayments.length}{pendingCVs.length > 0 ? ` + ${pendingCVs.length} pending` : ''})</div>
                                              <div className="max-h-40 overflow-y-auto space-y-1">
                                                {allPayments.map((p: any) => {
                                                  const { utr, prefix } = parseUtr(p.reference);
                                                  const isConfirmed = (p.paymentStatus || 'CONFIRMED') === 'CONFIRMED';
                                                  return (
                                                  <div key={p.id} className="bg-white border border-slate-200 px-2 py-1.5">
                                                    <div className="flex items-center justify-between">
                                                      <span>{fmtDate(p.paymentDate)} <span className="text-[8px] uppercase text-slate-400">{p.mode}</span></span>
                                                      <span className="font-mono tabular-nums text-green-700 font-medium">{fmt(p.amount)}</span>
                                                    </div>
                                                    {/* Clean UTR line */}
                                                    {utr && (
                                                      <div className="mt-0.5">
                                                        <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">UTR:</span>{' '}
                                                        <span className="text-[10px] font-mono font-bold text-slate-800 select-all">{utr}</span>
                                                      </div>
                                                    )}
                                                    {prefix && <div className="text-[8px] text-slate-400 mt-0 font-mono">{prefix}</div>}
                                                    {/* GST status chip */}
                                                    <div className="flex items-center gap-1 mt-1">
                                                      {p.hasGst === true && <span className="text-[8px] font-bold uppercase text-green-700 bg-green-50 border border-green-300 px-1 py-0.5">Incl. GST</span>}
                                                      {p.hasGst === false && <span className="text-[8px] font-bold uppercase text-orange-700 bg-orange-50 border border-orange-300 px-1 py-0.5">Without GST</span>}
                                                      {(p.hasGst === null || p.hasGst === undefined) && <span className="text-[8px] font-bold uppercase text-slate-400 bg-slate-50 border border-slate-200 px-1 py-0.5">GST —</span>}
                                                      {p.adviceSentAt && (
                                                        <span className="text-[8px] font-bold uppercase text-blue-700 bg-blue-50 border border-blue-300 px-1 py-0.5 inline-flex items-center gap-0.5" title={`Sent to ${p.adviceSentTo || 'vendor'}`}>
                                                          <Mail size={8} /> Sent {fmtDate(p.adviceSentAt)}
                                                        </span>
                                                      )}
                                                    </div>
                                                    {/* Advice actions */}
                                                    {isConfirmed && (
                                                      <div className="flex gap-1 mt-1">
                                                        <a href={`/api/vendor-payments/${p.id}/pdf?token=${localStorage.getItem('token')}`} target="_blank" rel="noopener noreferrer"
                                                          className="px-1.5 py-0.5 bg-emerald-700 text-white text-[8px] font-bold uppercase hover:bg-emerald-800 inline-flex items-center gap-0.5">
                                                          <FileText size={8} /> Advice
                                                        </a>
                                                        <button type="button"
                                                          onClick={async () => {
                                                            const r = await sendPaymentAdvice(p.id, vendorNameForPO, vendorEmailForPO);
                                                            if (r.ok) {
                                                              alert(`Payment Advice sent to ${r.sentTo}`);
                                                              if (selectedPOId) {
                                                                const ref = await api.get(`/purchase-orders/${selectedPOId}`);
                                                                setPODetail(ref.data);
                                                              }
                                                            } else if (r.error !== 'Cancelled') {
                                                              alert(`Failed: ${r.error}`);
                                                            }
                                                          }}
                                                          className="px-1.5 py-0.5 bg-blue-600 text-white text-[8px] font-bold uppercase hover:bg-blue-700 inline-flex items-center gap-0.5"
                                                          title={vendorEmailForPO ? `Email advice to ${vendorEmailForPO}` : 'Email advice (will prompt for email)'}>
                                                          <Mail size={8} /> {p.adviceSentAt ? 'Resend' : 'Email'}
                                                        </button>
                                                      </div>
                                                    )}
                                                  </div>
                                                  );
                                                })}
                                                {pendingCVs.map((v: any) => (
                                                  <div key={v.id} className="bg-yellow-50 border border-yellow-300 px-2 py-1.5">
                                                    <div className="flex items-center justify-between">
                                                      <span><span className="text-[8px] font-bold uppercase text-yellow-700 bg-yellow-100 px-1 py-0.5 border border-yellow-400">Awaiting Cash</span> CV#{v.voucherNo}</span>
                                                      <span className="font-mono tabular-nums text-yellow-700 font-medium">{fmt(v.amount)}</span>
                                                    </div>
                                                  </div>
                                                ))}
                                                {allPayments.length === 0 && pendingCVs.length === 0 && <div className="text-slate-400">No payments</div>}
                                              </div>
                                            </>;
                                          })()}
                                        </div>
                                      </div>

                                      {/* Document Downloads */}
                                      <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                                        <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Documents:</span>
                                        <a href={`/api/purchase-orders/${item.poId}/pdf?token=${localStorage.getItem('token')}`} target="_blank" rel="noopener noreferrer"
                                          className="px-2 py-0.5 bg-slate-700 text-white text-[9px] font-bold uppercase hover:bg-slate-800 inline-flex items-center gap-1">
                                          <FileText size={9} /> PO
                                        </a>
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
                            <td className="px-3 py-2 text-[10px] uppercase tracking-widest" colSpan={3}>Total ({filtered.length} POs)</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(filtered.reduce((s, i) => s + i.poAmount, 0))}</td>
                            <td colSpan={2}></td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums text-yellow-300">{fmt(filtered.reduce((s, i) => s + (i.pendingCash || 0), 0))}</td>
                            <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(filtered.reduce((s, i) => s + i.balance, 0))}</td>
                            <td colSpan={4}></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>
                  ); })()}
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
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Remarks</th>
                        <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest" style={{ width: '40px' }}></th>
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
                          <td className="px-3 py-1.5 text-center">
                            {p.payeeType === 'VENDOR' && (
                              <div className="flex gap-1 justify-center flex-wrap">
                                <button onClick={(e) => { e.stopPropagation(); window.open(`/api/vendor-payments/${p.id}/pdf?token=${localStorage.getItem('token')}`, '_blank'); }}
                                  className="px-1.5 py-0.5 bg-slate-600 text-white text-[9px] font-bold uppercase hover:bg-slate-700" title="Download Payment Advice">
                                  ADVICE
                                </button>
                                <button onClick={(e) => { e.stopPropagation(); setScanTarget({ paymentId: p.id, payee: p.payee, amount: p.amount, existing: p.bankReceiptPath }); setScanFile(null); setScanResult(null); }}
                                  className={`px-1.5 py-0.5 text-white text-[9px] font-bold uppercase inline-flex items-center gap-0.5 ${p.bankReceiptPath ? 'bg-purple-500 hover:bg-purple-600' : 'bg-purple-700 hover:bg-purple-800'}`}
                                  title={p.bankReceiptPath ? 'Bank receipt already scanned — click to re-scan or view' : 'Upload bank confirmation (PDF/JPG) for AI extraction'}>
                                  <Scan size={9} /> {p.bankReceiptPath ? 'RESCAN' : 'SCAN'}
                                </button>
                                {p.paymentStatus === 'CONFIRMED' && (
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation();
                                      const r = await sendPaymentAdvice(p.id, p.payee, p.vendorEmail);
                                      if (r.ok) {
                                        alert(`Payment Advice sent to ${r.sentTo}`);
                                        fetchCompleted();
                                      } else if (r.error !== 'Cancelled') {
                                        alert(`Failed to send: ${r.error}`);
                                      }
                                    }}
                                    className={`px-1.5 py-0.5 text-white text-[9px] font-bold uppercase inline-flex items-center gap-0.5 ${p.adviceSentAt ? 'bg-slate-500 hover:bg-slate-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                                    title={p.adviceSentAt ? `Sent ${fmtDate(p.adviceSentAt)} to ${p.adviceSentTo || ''}. Click to resend.` : (p.vendorEmail ? `Email advice to ${p.vendorEmail}` : 'Email advice to vendor (prompts for email)')}>
                                    <Mail size={9} /> {p.adviceSentAt ? 'SENT' : 'EMAIL'}
                                  </button>
                                )}
                              </div>
                            )}
                          </td>
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
                                    {(() => { const { utr, prefix } = parseUtr(p.reference); return (<>
                                      <div>UTR: <span className="text-slate-900 font-mono font-bold select-all">{utr || '--'}</span></div>
                                      {prefix && <div className="text-slate-400">Ref: <span className="font-mono">{prefix}</span></div>}
                                    </>); })()}
                                    <div>Amount: <span className="text-slate-800 font-bold font-mono">{fmt(p.amount)}</span></div>
                                    {(p.tdsDeducted || 0) > 0 && <div>TDS: <span className="text-slate-800 font-mono">{fmt(p.tdsDeducted || 0)}</span></div>}
                                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                                      {p.hasGst === true && <span className="text-[8px] font-bold uppercase text-green-700 bg-green-50 border border-green-300 px-1 py-0.5">Incl. GST</span>}
                                      {p.hasGst === false && <span className="text-[8px] font-bold uppercase text-orange-700 bg-orange-50 border border-orange-300 px-1 py-0.5">Without GST</span>}
                                      {(p.hasGst === null || p.hasGst === undefined) && <span className="text-[8px] font-bold uppercase text-slate-400 bg-slate-50 border border-slate-200 px-1 py-0.5">GST not captured</span>}
                                      {p.adviceSentAt && (
                                        <span className="text-[8px] font-bold uppercase text-blue-700 bg-blue-50 border border-blue-300 px-1 py-0.5 inline-flex items-center gap-0.5" title={`Advice emailed to ${p.adviceSentTo || 'vendor'}`}>
                                          <Mail size={8} /> Sent {fmtDate(p.adviceSentAt)}
                                        </span>
                                      )}
                                    </div>
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
                              {(p.poId || p.grnId || p.invoiceFilePath || p.payeeType === 'VENDOR') && (
                                <div className="flex items-center gap-2 mt-3 pt-2 border-t border-slate-200 flex-wrap">
                                  <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">Documents:</span>
                                  {p.payeeType === 'VENDOR' && (
                                    <a href={`/api/vendor-payments/${p.id}/pdf?token=${localStorage.getItem('token')}`} target="_blank" rel="noopener noreferrer"
                                      className="px-2 py-0.5 bg-emerald-700 text-white text-[9px] font-bold uppercase hover:bg-emerald-800 inline-flex items-center gap-1">
                                      <FileText size={9} /> Payment Advice
                                    </a>
                                  )}
                                  {p.payeeType === 'VENDOR' && p.paymentStatus === 'CONFIRMED' && (
                                    <button
                                      onClick={async () => {
                                        const r = await sendPaymentAdvice(p.id, p.payee, p.vendorEmail);
                                        if (r.ok) {
                                          alert(`Payment Advice sent to ${r.sentTo}`);
                                          fetchCompleted();
                                        } else if (r.error !== 'Cancelled') {
                                          alert(`Failed: ${r.error}`);
                                        }
                                      }}
                                      className={`px-2 py-0.5 text-white text-[9px] font-bold uppercase inline-flex items-center gap-1 ${p.adviceSentAt ? 'bg-slate-500 hover:bg-slate-600' : 'bg-blue-600 hover:bg-blue-700'}`}
                                      title={p.adviceSentAt ? `Sent ${fmtDate(p.adviceSentAt)} to ${p.adviceSentTo || ''}. Click to resend.` : (p.vendorEmail ? `Email advice to ${p.vendorEmail}` : 'No vendor email on file — will prompt')}>
                                      <Mail size={9} /> {p.adviceSentAt ? `Resend Advice (last sent ${fmtDate(p.adviceSentAt)})` : `Email Advice to Vendor${p.vendorEmail ? ` (${p.vendorEmail})` : ''}`}
                                    </button>
                                  )}
                                  {p.poId && (
                                    <a href={`/api/purchase-orders/${p.poId}/pdf?token=${localStorage.getItem('token')}`} target="_blank" rel="noopener noreferrer"
                                      className="px-2 py-0.5 bg-slate-700 text-white text-[9px] font-bold uppercase hover:bg-slate-800 inline-flex items-center gap-1">
                                      <FileText size={9} /> PO
                                    </a>
                                  )}
                                  {p.invoiceFilePath && (
                                    <a href={`/uploads/${p.invoiceFilePath}`} target="_blank" rel="noopener noreferrer"
                                      className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-bold uppercase hover:bg-blue-700 inline-flex items-center gap-1">
                                      <FileText size={9} /> Invoice
                                    </a>
                                  )}
                                  {p.poId && (
                                    <a href={`/procurement/purchase-orders?highlight=${p.poId}`}
                                      className="px-2 py-0.5 border border-slate-400 text-slate-600 text-[9px] font-bold uppercase hover:bg-slate-100 inline-flex items-center gap-1">
                                      View Full PO Pipeline
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
            {/* KPI Strip */}
            {outstandingSummary && (
              <div className="grid grid-cols-2 md:grid-cols-5 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Outstanding</div>
                  <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(outstandingSummary.totalOutstanding)}</div>
                  <div className="text-[10px] text-slate-400">{outstandingSummary.itemCount} items</div>
                </div>
                <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Vendor Invoices</div>
                  <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(outstandingSummary.vendorOutstanding)}</div>
                </div>
                <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-purple-500">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Contractor Bills</div>
                  <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(outstandingSummary.contractorOutstanding)}</div>
                </div>
                <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-orange-500">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Overdue &gt; 30d</div>
                  <div className="text-xl font-bold text-red-600 mt-1 font-mono tabular-nums">{fmt(outstandingSummary.overdueAmount)}</div>
                </div>
                <div className="bg-white px-4 py-3 border-l-4 border-l-slate-500">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Parties</div>
                  <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{outstandingSummary.partyCount}</div>
                </div>
              </div>
            )}

            {/* Filter Tabs */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3">
              {(['ALL','VENDOR','CONTRACTOR'] as const).map(f => (
                <button key={f} onClick={() => setOutstandingFilter(f)}
                  className={`px-3 py-1 text-[11px] font-bold uppercase tracking-widest ${outstandingFilter === f ? 'bg-slate-800 text-white' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'}`}>
                  {f}
                </button>
              ))}
            </div>

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
              {(() => {
                const filtered = unifiedItems.filter(it => outstandingFilter === 'ALL' || it.partyType === outstandingFilter);
                const filteredTotal = filtered.reduce((s, i) => s + i.balanceAmount, 0);
                return (
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-800 text-white">
                        <th className="w-8 px-2 py-2 border-r border-slate-700">
                          <input type="checkbox" onChange={toggleAllInvoices}
                            checked={outstanding.length > 0 && selectedInvoiceIds.size === outstanding.flatMap(o => o.invoices).length}
                            className="w-3 h-3 accent-blue-500" />
                        </th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Party</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Ref No</th>
                        <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Net Payable</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Paid</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Balance</th>
                        <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Aging</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((it, j) => {
                        const isVendor = it.partyType === 'VENDOR';
                        const checkable = isVendor;
                        return (
                          <tr key={it.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${checkable && selectedInvoiceIds.has(it.id) ? 'bg-blue-50' : j % 2 ? 'bg-slate-50/70' : ''}`}>
                            <td className="px-2 py-1.5 border-r border-slate-100 text-center">
                              {checkable && (
                                <input type="checkbox" checked={selectedInvoiceIds.has(it.id)}
                                  onChange={() => toggleInvoice(it.id)} className="w-3 h-3 accent-blue-500" />
                              )}
                            </td>
                            <td className="px-3 py-1.5 border-r border-slate-100">
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${isVendor ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-purple-300 bg-purple-50 text-purple-700'}`}>{it.partyType}</span>
                            </td>
                            <td className="px-3 py-1.5 border-r border-slate-100 font-medium text-slate-800">{it.partyName}</td>
                            <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-slate-600">{it.refNo}</td>
                            <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600 whitespace-nowrap">{fmtDate(it.date)}</td>
                            <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums">{fmtDec(it.netPayable)}</td>
                            <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums text-slate-500">{it.paidAmount > 0 ? fmtDec(it.paidAmount) : '--'}</td>
                            <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums font-bold text-red-600">{fmtDec(it.balanceAmount)}</td>
                            <td className={`px-3 py-1.5 text-right text-[11px] font-mono ${it.daysOverdue > 30 ? 'text-red-600 font-bold' : 'text-slate-500'}`}>{it.daysOverdue}d</td>
                          </tr>
                        );
                      })}
                    </tbody>
                    {filtered.length > 0 && (
                      <tfoot>
                        <tr className="bg-slate-800 text-white font-semibold">
                          <td className="px-2 py-2"></td>
                          <td className="px-3 py-2 text-[10px] uppercase tracking-widest" colSpan={6}>Total ({filtered.length} items)</td>
                          <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtDec(filteredTotal)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    )}
                  </table>
                );
              })()}
              {unifiedItems.length === 0 && (
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

              {/* STEP 1: Payment Instructions — show bank details for manual transfer */}
              {payStep === 'instructions' && (
                <div className="p-4 space-y-3">
                  <div className="bg-blue-50 border border-blue-200 px-4 py-3">
                    <div className="text-[10px] font-bold text-blue-800 uppercase tracking-widest mb-2">Payment Instructions</div>
                    <div className="text-xs text-blue-900">Transfer the amount below to the vendor's bank account, then click "I've Paid" to confirm.</div>
                  </div>

                  {/* Amount to pay */}
                  <div className="bg-slate-800 text-white px-4 py-3 text-center">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400">Amount to Pay</div>
                    <div className="text-2xl font-bold font-mono tabular-nums mt-1">{fmtDec(parseFloat(payForm.amount) || payModal.invoice.balanceAmount)}</div>
                    {payForm.tdsDeducted && parseFloat(payForm.tdsDeducted) > 0 && (
                      <div className="text-[10px] text-slate-400 mt-1">After TDS deduction of {fmtDec(parseFloat(payForm.tdsDeducted))} ({payForm.tdsSection})</div>
                    )}
                  </div>

                  {/* Vendor bank details */}
                  {vendorBank && vendorBank.bankAccount ? (
                    <div className="border border-slate-300">
                      <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-300">Vendor Bank Details</div>
                      <div className="p-3 space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-slate-500">Beneficiary Name</span><span className="font-bold text-slate-800">{payModal.item.vendorName}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Bank</span><span className="font-medium">{vendorBank.bankName}{vendorBank.bankBranch ? `, ${vendorBank.bankBranch}` : ''}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Account No</span><span className="font-mono font-bold text-slate-800 select-all">{vendorBank.bankAccount}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">IFSC Code</span><span className="font-mono font-bold text-slate-800 select-all">{vendorBank.bankIfsc}</span></div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
                      Vendor bank details not on file. Add them in Vendor Master before generating bank payment.
                    </div>
                  )}

                  {/* Payment reference suggestion */}
                  <div className="border border-slate-200 px-3 py-2 bg-slate-50 text-xs text-slate-600">
                    <span className="font-bold">Suggested Reference:</span> PO-{payModal.item.poNo} / {payModal.invoice.vendorInvNo || 'INV'}
                  </div>

                  <div className="flex gap-2 pt-3 border-t border-slate-200">
                    <button type="button" onClick={() => setPayStep('confirm')}
                      className="px-4 py-1.5 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700">
                      I'VE PAID — CONFIRM DETAILS
                    </button>
                    <button type="button" onClick={() => {
                      // Pay with cash instead — switch to split mode with cash
                      setSplitMode(false);
                      setPayForm(f => ({ ...f, mode: 'CASH' }));
                      setPayStep('confirm');
                    }} className="px-4 py-1.5 bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700">
                      PAY CASH
                    </button>
                    <button type="button" onClick={() => {
                      // Split — part cash, part bank
                      setSplitMode(true);
                      setSplits([{ mode: 'CASH', amount: '', reference: '' }, { mode: 'NEFT', amount: '', reference: '' }]);
                      setPayStep('confirm');
                    }} className="px-4 py-1.5 bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700">
                      SPLIT (CASH + BANK)
                    </button>
                    <button type="button" onClick={() => setPayModal(null)}
                      className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">CANCEL</button>
                  </div>
                </div>
              )}

              {/* STEP 2: Confirm Payment — enter UTR/reference and finalize */}
              {payStep === 'confirm' && (
              <form onSubmit={submitPayment} className="p-4 space-y-3">
                {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5">{error}</div>}

                {/* Compulsory GST declaration */}
                <div className={`border px-3 py-2 ${payHasGst === null ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <label className={`text-[10px] font-bold uppercase tracking-widest ${payHasGst === null ? 'text-red-700' : 'text-slate-600'}`}>Does this payment include GST? *</label>
                    <button type="button" onClick={() => setPayHasGst(true)}
                      className={`px-3 py-1 text-[10px] font-bold uppercase border ${payHasGst === true ? 'border-green-600 bg-green-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-green-50'}`}>
                      Yes — Includes GST
                    </button>
                    <button type="button" onClick={() => setPayHasGst(false)}
                      className={`px-3 py-1 text-[10px] font-bold uppercase border ${payHasGst === false ? 'border-orange-600 bg-orange-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-orange-50'}`}>
                      No — Without GST / Advance
                    </button>
                    {payHasGst === null && <span className="text-[10px] text-red-600 font-semibold">Required before submitting</span>}
                  </div>
                </div>

                {/* Split payment toggle */}
                <div className="flex items-center gap-2 pb-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Split Payment (Cash + Bank)</label>
                  <button type="button" onClick={() => { setSplitMode(!splitMode); if (!splitMode) setSplits([{ mode: 'CASH', amount: '', reference: '' }, { mode: 'NEFT', amount: '', reference: '' }]); }}
                    className={`w-8 h-4 rounded-full transition relative ${splitMode ? 'bg-blue-600' : 'bg-slate-300'}`}>
                    <span className={`block w-3 h-3 bg-white rounded-full absolute top-0.5 transition ${splitMode ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </div>

                {!splitMode ? (
                  /* Single payment mode */
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
                        {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reference (UTR)</label>
                      <input type="text" value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))}
                        placeholder="UTR / Cheque No" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                  </div>
                ) : (
                  /* Split payment mode — dynamic rows */
                  <div className="space-y-2">
                    {splits.map((sp, idx) => (
                      <div key={idx} className="grid grid-cols-[120px_1fr_1fr_30px] gap-2 items-end">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Mode</label>
                          <select value={sp.mode} onChange={e => setSplits(s => s.map((x, i) => i === idx ? { ...x, mode: e.target.value } : x))}
                            className="border border-slate-300 px-2 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                            {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Amount</label>
                          <input type="number" step="0.01" value={sp.amount} onChange={e => setSplits(s => s.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))}
                            className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reference</label>
                          <input type="text" value={sp.reference} onChange={e => setSplits(s => s.map((x, i) => i === idx ? { ...x, reference: e.target.value } : x))}
                            placeholder={sp.mode === 'CASH' ? 'Slip #' : 'UTR / Ref'} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        </div>
                        <button type="button" onClick={() => setSplits(s => s.filter((_, i) => i !== idx))}
                          className="text-red-400 hover:text-red-600 pb-1" title="Remove">{splits.length > 1 ? '\u00D7' : ''}</button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={() => setSplits(s => [...s, { mode: 'NEFT', amount: '', reference: '' }])}
                        className="text-[10px] font-bold text-blue-600 uppercase tracking-widest hover:text-blue-800">+ Add Split</button>
                      <div className="text-xs font-mono tabular-nums">
                        Total: <span className={`font-bold ${Math.abs(splits.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0) - (parseFloat(payForm.amount) || payModal?.invoice.balanceAmount || 0)) < 1 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmtDec(splits.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0))}
                        </span>
                        {' / '}{fmtDec(parseFloat(payForm.amount) || payModal?.invoice.balanceAmount || 0)}
                      </div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Date *</label>
                    <input type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div className="col-span-2">
                    {tdsLoading && <div className="text-[10px] text-slate-400 uppercase tracking-widest">Calculating TDS...</div>}
                    {tdsCalc && (
                      <div className={`border px-3 py-2 text-xs ${tdsCalc.shouldDeduct ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">TDS Calculation</span>
                          {tdsCalc.shouldDeduct && (
                            <label className="flex items-center gap-1.5 text-[10px]">
                              <input type="checkbox" checked={tdsOverride} onChange={e => {
                                setTdsOverride(e.target.checked);
                                if (!e.target.checked) setPayForm(f => ({ ...f, tdsDeducted: '0', tdsSection: '', tdsLedgerId: '' }));
                                else setPayForm(f => ({ ...f, tdsDeducted: String(tdsCalc.tdsAmount), tdsSection: tdsCalc.sectionLabel, tdsLedgerId: tdsCalc.ledgerId || '' }));
                              }} className="w-3 h-3" />
                              <span className="text-slate-600 font-medium">Apply TDS</span>
                            </label>
                          )}
                        </div>
                        {tdsCalc.shouldDeduct ? (
                          <div className="space-y-1">
                            <div className="flex justify-between"><span className="text-slate-500">Section</span><span className="font-medium text-slate-800">{tdsCalc.sectionLabel}</span></div>
                            <div className="flex justify-between"><span className="text-slate-500">Rate</span><span className="font-mono font-medium">{tdsCalc.rate}%</span></div>
                            <div className="flex justify-between"><span className="text-slate-500">TDS Amount</span><span className="font-mono font-bold text-amber-700">{tdsCalc.tdsAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                            <div className="flex justify-between"><span className="text-slate-500">Net to Vendor</span><span className="font-mono font-bold text-green-700">{tdsCalc.netAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></div>
                            <div className="text-[9px] text-slate-400 mt-1 leading-relaxed">{tdsCalc.reason}</div>
                          </div>
                        ) : (
                          <div className="text-slate-500">{tdsCalc.reason}</div>
                        )}
                      </div>
                    )}
                    {!tdsCalc && !tdsLoading && (
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Deducted (manual)</label>
                          <input type="number" step="0.01" value={payForm.tdsDeducted} onChange={e => setPayForm(f => ({ ...f, tdsDeducted: e.target.value }))}
                            className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        </div>
                        <div>
                          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Section</label>
                          <input type="text" value={payForm.tdsSection} onChange={e => setPayForm(f => ({ ...f, tdsSection: e.target.value }))}
                            placeholder="194C, 194Q..." className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        </div>
                      </div>
                    )}
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
                  <button type="button" onClick={() => setPayStep('instructions')}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">BACK</button>
                  <button type="button" onClick={() => setPayModal(null)}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">CANCEL</button>
                </div>
              </form>
              )}
            </div>
          </div>
        )}
        {/* ═══════════════════════════════════════ */}
        {/* DIRECT PAYMENT MODAL (fuel deals without invoice) */}
        {/* ═══════════════════════════════════════ */}
        {directPayItem && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-2xl mx-4">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard size={14} />
                  <span className="text-xs font-bold uppercase tracking-widest">Direct Payment — Fuel Deal</span>
                </div>
                <button onClick={() => setDirectPayItem(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>
              <div className="bg-slate-100 px-4 py-2 text-xs border-b border-slate-300 flex gap-6">
                <span><strong>Vendor:</strong> {directPayItem.vendorName}</span>
                <span><strong>PO:</strong> PO-{directPayItem.poNo}</span>
                <span><strong>GRN Value:</strong> <span className="text-red-600 font-bold">{fmtDec(directPayItem.grnTotalValue)}</span></span>
                <span><strong>Trucks:</strong> {directPayItem.grnCount}</span>
              </div>

              {/* STEP 1: Payment Instructions */}
              {payStep === 'instructions' && (
                <div className="p-4 space-y-3">
                  <div className="bg-blue-50 border border-blue-200 px-4 py-3">
                    <div className="text-[10px] font-bold text-blue-800 uppercase tracking-widest mb-2">Payment Instructions</div>
                    <div className="text-xs text-blue-900">Choose how to pay. You can pay the full amount or a partial amount now and the rest later.</div>
                  </div>
                  <div className="bg-slate-800 text-white px-4 py-3 text-center">
                    <div className="text-[10px] uppercase tracking-widest text-slate-400">Total Outstanding</div>
                    <div className="text-2xl font-bold font-mono tabular-nums mt-1">{fmtDec(directPayItem.grnTotalValue)}</div>
                  </div>
                  {vendorBank && vendorBank.bankAccount ? (
                    <div className="border border-slate-300">
                      <div className="bg-slate-100 px-3 py-1.5 text-[10px] font-bold text-slate-500 uppercase tracking-widest border-b border-slate-300">Vendor Bank Details</div>
                      <div className="p-3 space-y-1.5 text-xs">
                        <div className="flex justify-between"><span className="text-slate-500">Beneficiary</span><span className="font-bold text-slate-800">{directPayItem.vendorName}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Bank</span><span className="font-medium">{vendorBank.bankName}{vendorBank.bankBranch ? `, ${vendorBank.bankBranch}` : ''}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">Account No</span><span className="font-mono font-bold text-slate-800 select-all">{vendorBank.bankAccount}</span></div>
                        <div className="flex justify-between"><span className="text-slate-500">IFSC</span><span className="font-mono font-bold text-slate-800 select-all">{vendorBank.bankIfsc}</span></div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-amber-50 border border-amber-200 px-4 py-3 text-xs text-amber-800">
                      Vendor bank details not on file. Add them in Vendor Master for bank payments.
                    </div>
                  )}
                  <div className="flex gap-2 pt-3 border-t border-slate-200">
                    <button type="button" onClick={() => { setPayStep('confirm'); setSplitMode(false); setPayForm(f => ({ ...f, mode: 'NEFT' })); }}
                      className="px-4 py-1.5 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700">
                      PAY VIA BANK
                    </button>
                    <button type="button" onClick={() => { setPayStep('confirm'); setSplitMode(false); setPayForm(f => ({ ...f, mode: 'CASH' })); }}
                      className="px-4 py-1.5 bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700">
                      PAY CASH
                    </button>
                    <button type="button" onClick={() => { setPayStep('confirm'); setSplitMode(true); setSplits([{ mode: 'CASH', amount: '', reference: '' }, { mode: 'NEFT', amount: '', reference: '' }]); }}
                      className="px-4 py-1.5 bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700">
                      SPLIT (CASH + BANK)
                    </button>
                    <button type="button" onClick={() => setDirectPayItem(null)}
                      className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">CANCEL</button>
                  </div>
                </div>
              )}

              {/* STEP 2: Confirm Payment */}
              {payStep === 'confirm' && (
              <form onSubmit={submitDirectPayment} className="p-4 space-y-3">
                {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5">{error}</div>}

                {/* Compulsory GST declaration */}
                <div className={`border px-3 py-2 ${payHasGst === null ? 'border-red-400 bg-red-50' : 'border-slate-200 bg-slate-50'}`}>
                  <div className="flex items-center gap-3 flex-wrap">
                    <label className={`text-[10px] font-bold uppercase tracking-widest ${payHasGst === null ? 'text-red-700' : 'text-slate-600'}`}>Does this payment include GST? *</label>
                    <button type="button" onClick={() => setPayHasGst(true)}
                      className={`px-3 py-1 text-[10px] font-bold uppercase border ${payHasGst === true ? 'border-green-600 bg-green-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-green-50'}`}>
                      Yes — Includes GST
                    </button>
                    <button type="button" onClick={() => setPayHasGst(false)}
                      className={`px-3 py-1 text-[10px] font-bold uppercase border ${payHasGst === false ? 'border-orange-600 bg-orange-600 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-orange-50'}`}>
                      No — Without GST / Advance
                    </button>
                    {payHasGst === null && <span className="text-[10px] text-red-600 font-semibold">Required before submitting</span>}
                  </div>
                </div>

                {/* Partial payment hint */}
                <div className="bg-slate-50 border border-slate-200 px-3 py-2 text-xs text-slate-600">
                  Enter the amount you are paying now. Remaining balance will stay as outstanding for future payment.
                </div>

                {/* Split toggle */}
                <div className="flex items-center gap-2 pb-1">
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Split Payment (Cash + Bank)</label>
                  <button type="button" onClick={() => { setSplitMode(!splitMode); if (!splitMode) setSplits([{ mode: 'CASH', amount: '', reference: '' }, { mode: 'NEFT', amount: '', reference: '' }]); }}
                    className={`w-8 h-4 rounded-full transition relative ${splitMode ? 'bg-blue-600' : 'bg-slate-300'}`}>
                    <span className={`block w-3 h-3 bg-white rounded-full absolute top-0.5 transition ${splitMode ? 'left-4' : 'left-0.5'}`} />
                  </button>
                </div>
                {!splitMode ? (
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
                        {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reference</label>
                      <input type="text" value={payForm.reference} onChange={e => setPayForm(f => ({ ...f, reference: e.target.value }))}
                        className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {splits.map((sp, idx) => (
                      <div key={idx} className="grid grid-cols-[120px_1fr_1fr_30px] gap-2 items-end">
                        <select value={sp.mode} onChange={e => setSplits(s => s.map((x, i) => i === idx ? { ...x, mode: e.target.value } : x))}
                          className="border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                          {MODES.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <input type="number" step="0.01" value={sp.amount} onChange={e => setSplits(s => s.map((x, i) => i === idx ? { ...x, amount: e.target.value } : x))}
                          placeholder="Amount" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        <input type="text" value={sp.reference} onChange={e => setSplits(s => s.map((x, i) => i === idx ? { ...x, reference: e.target.value } : x))}
                          placeholder={sp.mode === 'CASH' ? 'Slip #' : 'UTR'} className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                        <button type="button" onClick={() => setSplits(s => s.filter((_, i) => i !== idx))}
                          className="text-red-400 hover:text-red-600 text-lg pb-1">{splits.length > 1 ? '\u00D7' : ''}</button>
                      </div>
                    ))}
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={() => setSplits(s => [...s, { mode: 'NEFT', amount: '', reference: '' }])}
                        className="text-[10px] font-bold text-blue-600 uppercase tracking-widest hover:text-blue-800">+ Add Split</button>
                      <div className="text-xs font-mono tabular-nums">
                        Total: <span className={`font-bold ${Math.abs(splits.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0) - (directPayItem.grnTotalValue || 0)) < 1 ? 'text-green-600' : 'text-red-600'}`}>
                          {fmtDec(splits.reduce((s, x) => s + (parseFloat(x.amount) || 0), 0))}
                        </span> / {fmtDec(directPayItem.grnTotalValue)}
                      </div>
                    </div>
                  </div>
                )}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Date *</label>
                    <input type="date" value={payForm.paymentDate} onChange={e => setPayForm(f => ({ ...f, paymentDate: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    {tdsCalc && tdsCalc.shouldDeduct ? (
                      <div className={`border px-2 py-1.5 text-[10px] ${tdsOverride ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50'}`}>
                        <div className="flex items-center justify-between">
                          <span className="font-bold uppercase tracking-widest text-slate-500">TDS {tdsCalc.rate}%</span>
                          <label className="flex items-center gap-1">
                            <input type="checkbox" checked={tdsOverride} onChange={e => {
                              setTdsOverride(e.target.checked);
                              if (!e.target.checked) setPayForm(f => ({ ...f, tdsDeducted: '0', tdsSection: '', tdsLedgerId: '' }));
                              else setPayForm(f => ({ ...f, tdsDeducted: String(tdsCalc.tdsAmount), tdsSection: tdsCalc.sectionLabel, tdsLedgerId: tdsCalc.ledgerId || '' }));
                            }} className="w-3 h-3" />
                            <span className="text-slate-600">Apply</span>
                          </label>
                        </div>
                        {tdsOverride && <div className="font-mono font-bold text-amber-700 mt-0.5">{tdsCalc.tdsAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</div>}
                      </div>
                    ) : (
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Deducted</label>
                        <input type="number" step="0.01" value={payForm.tdsDeducted} onChange={e => setPayForm(f => ({ ...f, tdsDeducted: e.target.value }))}
                          className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </div>
                    )}
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
                    {submitting ? 'PROCESSING...' : 'CONFIRM PAYMENT'}
                  </button>
                  <button type="button" onClick={() => setPayStep('instructions')}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">BACK</button>
                  <button type="button" onClick={() => setDirectPayItem(null)}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">CANCEL</button>
                </div>
              </form>
              )}
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
        {/* ═══════════════════════════════════════ */}
        {/* PO PAY MODAL (Running Account) */}
        {/* ═══════════════════════════════════════ */}
        {poPayItem && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4" onClick={() => setPoPayItem(null)}>
            <div className="bg-white shadow-2xl w-full max-w-lg mx-4" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest">Pay Against PO-{poPayItem.poNo}</span>
                <button onClick={() => setPoPayItem(null)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>
              <div className="bg-slate-100 px-4 py-3 text-xs border-b border-slate-300 space-y-2">
                <div className="flex gap-6">
                  <span>Vendor: <b>{poPayItem.vendorName}</b></span>
                  {poPayItem.vendorPhone && <span>Ph: <b>{poPayItem.vendorPhone}</b></span>}
                  {poPayItem.material && <span>Material: <b>{poPayItem.material}</b></span>}
                </div>
                <div className="flex gap-6">
                  <span>PO Total: <b className="font-mono">{fmt(poPayItem.poAmount)}</b></span>
                  <span>Received: <b className="font-mono text-blue-700">{fmt(poReceivedValue || poPayItem.grnTotalValue)}</b></span>
                  <span>Paid: <b className="font-mono text-green-700">{fmt(poPayItem.totalPaid)}</b></span>
                  {poPendingCash > 0 && <span>Pending: <b className="font-mono text-yellow-600">{fmt(poPendingCash)}</b></span>}
                  <span>Payable Now: <b className="font-mono text-red-600 text-sm">{fmt(Math.max(0, (poReceivedValue || poPayItem.grnTotalValue) - poPayItem.totalPaid - poPendingCash))}</b></span>
                  {poPayItem.dueDate && <span>Due: <b>{fmtDate(poPayItem.dueDate)}</b></span>}
                </div>
                <div className="flex gap-6 text-[11px] bg-white border border-slate-200 px-3 py-1.5">
                  <span className="text-slate-500 uppercase tracking-widest text-[9px] font-bold self-center">PO Breakdown</span>
                  <span>Base: <b className="font-mono">{fmt(poPayItem.poSubtotal || (poPayItem.poAmount - (poPayItem.poGst || 0)))}</b></span>
                  <span>+ GST: <b className="font-mono text-blue-700">{fmt(poPayItem.poGst || 0)}</b>
                    {poPayItem.poGst > 0 && poPayItem.poSubtotal ? <span className="text-[9px] text-slate-400 ml-1">({((poPayItem.poGst / poPayItem.poSubtotal) * 100).toFixed(0)}%)</span> : null}
                  </span>
                  <span>= Total: <b className="font-mono">{fmt(poPayItem.poAmount)}</b></span>
                </div>
                {poPayItem.vendorBank && (
                  <div className="bg-white border border-slate-200 px-3 py-1.5 flex gap-6">
                    <span>Bank: <b>{poPayItem.vendorBank}</b></span>
                    {poPayItem.vendorAccount && <span>A/C: <b className="font-mono">{poPayItem.vendorAccount}</b></span>}
                    {poPayItem.vendorIfsc && <span>IFSC: <b className="font-mono">{poPayItem.vendorIfsc}</b></span>}
                  </div>
                )}
                {!poPayItem.vendorBank && (
                  <div className="text-[10px] text-orange-600 font-bold uppercase">No bank details on file — update vendor master</div>
                )}
              </div>
              <div className="p-4 space-y-3">
                {poPendingCash > 0 && (
                  <div className="bg-yellow-50 border border-yellow-300 px-3 py-2 text-xs">
                    <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-yellow-400 bg-yellow-100 text-yellow-800 mr-2">Awaiting Cash Confirmation</span>
                    {fmt(poPendingCash)} in pending cash voucher{poPendingCashVouchers.length > 1 ? 's' : ''} ({poPendingCashVouchers.map(v => `#${v.voucherNo}`).join(', ')})
                  </div>
                )}
                <div className="flex items-center justify-between border-b border-slate-200 pb-1">
                  <span className="text-[10px] font-bold text-slate-800 uppercase tracking-widest">Payment Against PO (No Invoice Required)</span>
                  {(() => {
                    const mp = Math.max(0, (poReceivedValue || poPayItem.grnTotalValue) - poPayItem.totalPaid - poPendingCash);
                    return mp > 0 ? (
                      <button onClick={() => { setPoPayAmount(String(Math.round(mp))); if (poPayItem.poGst > 0) setPoPayIncludeGst(true); }}
                        className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-bold uppercase hover:bg-blue-700">Pay All {fmt(mp)}</button>
                    ) : null;
                  })()}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Amount *</label>
                    {(() => {
                      const maxPayable = Math.max(0, (poReceivedValue || poPayItem.grnTotalValue) - poPayItem.totalPaid - poPendingCash);
                      return <>
                        <input value={poPayAmount} onChange={e => setPoPayAmount(e.target.value)} type="number" autoFocus max={maxPayable}
                          className="w-full border border-slate-300 px-2.5 py-1.5 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder={String(Math.round(maxPayable))} />
                        <div className="text-[9px] text-slate-400 mt-0.5">Max payable: {fmt(maxPayable)}</div>
                      </>;
                    })()}
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Payment Mode</label>
                    <select value={poPayMode} onChange={e => setPoPayMode(e.target.value)}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="NEFT">NEFT (Bank Transfer)</option>
                      <option value="RTGS">RTGS</option>
                      <option value="UPI">UPI</option>
                      <option value="CASH">Cash</option>
                      <option value="CHEQUE">Cheque</option>
                    </select>
                  </div>
                  <div className="col-span-2">
                    {poPayItem.poGst > 0 ? (
                      <>
                        <label className="text-[10px] font-bold text-red-600 uppercase tracking-widest block mb-1">Tax Treatment * (Required)</label>
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => setPoPayIncludeGst(true)}
                            className={`px-3 py-2 border text-left text-xs ${poPayIncludeGst === true ? 'border-green-500 bg-green-50 text-green-800' : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50'}`}>
                            <div className="font-bold uppercase tracking-widest text-[10px] flex items-center gap-1">
                              <span className={`inline-block w-2 h-2 rounded-full ${poPayIncludeGst === true ? 'bg-green-600' : 'bg-slate-300'}`}></span>
                              Pay Including GST
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">Base + GST = full invoice value</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">GST included: <b className="font-mono">{fmt(poPayItem.poGst)}</b></div>
                          </button>
                          <button type="button" onClick={() => setPoPayIncludeGst(false)}
                            className={`px-3 py-2 border text-left text-xs ${poPayIncludeGst === false ? 'border-orange-500 bg-orange-50 text-orange-800' : 'border-slate-300 bg-white text-slate-500 hover:bg-slate-50'}`}>
                            <div className="font-bold uppercase tracking-widest text-[10px] flex items-center gap-1">
                              <span className={`inline-block w-2 h-2 rounded-full ${poPayIncludeGst === false ? 'bg-orange-600' : 'bg-slate-300'}`}></span>
                              Pay Without GST
                            </div>
                            <div className="text-[10px] text-slate-500 mt-0.5">Base amount only — pay GST separately later</div>
                            <div className="text-[10px] text-slate-400 mt-0.5">GST deferred: <b className="font-mono">{fmt(poPayItem.poGst)}</b></div>
                          </button>
                        </div>
                        {poPayIncludeGst === null && (
                          <div className="mt-1 text-[10px] text-red-600 font-semibold">You must pick one before submitting.</div>
                        )}
                      </>
                    ) : (
                      <div className="text-[10px] text-slate-400 bg-slate-50 border border-slate-200 px-3 py-1.5">
                        GST: <b>0% — No GST on this item</b> (will be recorded as "Without GST")
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">UTR / Reference</label>
                    <input value={poPayRef} onChange={e => setPoPayRef(e.target.value)}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Enter after bank confirms" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Remarks</label>
                    <input value={poPayRemarks} onChange={e => setPoPayRemarks(e.target.value)}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                {poPayMode === 'CASH' && (
                  <div className="text-[10px] text-orange-600 bg-orange-50 border border-orange-200 px-3 py-1.5">
                    Cash payment will auto-create a Cash Voucher entry
                  </div>
                )}
                <button onClick={submitPOPayment} disabled={poPaySaving || !poPayAmount}
                  className="w-full px-4 py-2 bg-green-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-green-700 disabled:opacity-50">
                  {poPaySaving
                    ? 'Processing...'
                    : `Pay ${poPayAmount ? '\u20B9' + parseFloat(poPayAmount).toLocaleString('en-IN') : ''} via ${poPayMode}${poPayItem.poGst > 0 ? (poPayIncludeGst ? ' (Incl. GST)' : ' (Ex. GST)') : ''}`}
                </button>

                {/* Pending bank payment — enter UTR to confirm */}
                {bankPendingPayment && (
                  <div className="bg-yellow-50 border border-yellow-300 p-3 mt-2">
                    <div className="text-[10px] font-bold text-yellow-800 uppercase tracking-widest mb-2">
                      Pending Bank Transfer — Payment #{bankPendingPayment.paymentNo}
                    </div>
                    <div className="text-xs text-slate-600 mb-2">
                      Amount: <b className="font-mono">{fmt(bankPendingPayment.amount)}</b> via <b>{bankPendingPayment.mode}</b>
                    </div>
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Enter UTR / Reference *</label>
                        <input value={bankUtrInput} onChange={e => setBankUtrInput(e.target.value)} autoFocus
                          className="w-full border border-yellow-400 bg-white px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-yellow-500" placeholder="UTR number from bank" />
                      </div>
                      <button onClick={async () => {
                        if (!bankUtrInput.trim()) { alert('Enter UTR to confirm'); return; }
                        setBankConfirming(true);
                        try {
                          await api.post(`/purchase-orders/payments/${bankPendingPayment.id}/confirm`, { reference: bankUtrInput.trim() });
                          setBankPendingPayment(null);
                          setBankUtrInput('');
                          await fetchPending(); // Refresh list BEFORE closing modal
                          setPoPayItem(null);
                        } catch (err: unknown) {
                          alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Confirm failed');
                        } finally { setBankConfirming(false); }
                      }} disabled={bankConfirming || !bankUtrInput.trim()}
                        className="px-4 py-1.5 bg-green-600 text-white text-[11px] font-bold uppercase hover:bg-green-700 disabled:opacity-50">
                        {bankConfirming ? '...' : 'Confirm'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Payment history ledger */}
                {poPayments.length > 0 && (
                  <div className="mt-3">
                    <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Payment History</div>
                    <table className="w-full text-[11px] border border-slate-200">
                      <thead>
                        <tr className="bg-slate-100">
                          <th className="text-left px-2 py-1 text-[9px] font-bold uppercase border-r border-slate-200">Date</th>
                          <th className="text-right px-2 py-1 text-[9px] font-bold uppercase border-r border-slate-200">Amount</th>
                          <th className="text-left px-2 py-1 text-[9px] font-bold uppercase border-r border-slate-200">Mode</th>
                          <th className="text-left px-2 py-1 text-[9px] font-bold uppercase border-r border-slate-200">Ref</th>
                          <th className="text-right px-2 py-1 text-[9px] font-bold uppercase">Running</th>
                        </tr>
                      </thead>
                      <tbody>
                        {poPayments.map((p, j) => (
                          <tr key={p.id} className={j % 2 ? 'bg-slate-50' : ''}>
                            <td className="px-2 py-1 font-mono text-slate-500 border-r border-slate-100">{fmtDate(p.paymentDate)}</td>
                            <td className="px-2 py-1 text-right font-mono tabular-nums text-green-700 border-r border-slate-100">{fmt(p.amount)}</td>
                            <td className="px-2 py-1 text-slate-600 border-r border-slate-100">{p.mode}</td>
                            <td className="px-2 py-1 text-slate-500 font-mono border-r border-slate-100">{p.reference || '--'}</td>
                            <td className="px-2 py-1 text-right font-mono tabular-nums font-bold">{fmt(p.runningTotal)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Scan Bank Receipt modal */}
        {scanTarget && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4" onClick={() => { setScanTarget(null); setScanFile(null); setScanResult(null); }}>
            <div className="bg-white w-full max-w-2xl my-4 shadow-xl" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-4 py-2 flex items-center justify-between">
                <div className="text-sm font-bold uppercase tracking-widest flex items-center gap-2"><Scan size={14} /> Scan Bank Receipt</div>
                <button onClick={() => { setScanTarget(null); setScanFile(null); setScanResult(null); }} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3 text-xs bg-slate-50 border border-slate-200 px-3 py-2">
                  <div><span className="text-slate-500 uppercase tracking-widest text-[9px] font-bold">Payee</span><div className="text-slate-800 font-medium">{scanTarget.payee}</div></div>
                  <div><span className="text-slate-500 uppercase tracking-widest text-[9px] font-bold">Amount on file</span><div className="text-slate-800 font-mono tabular-nums">{fmt(scanTarget.amount)}</div></div>
                </div>

                {scanTarget.existing && !scanResult && (
                  <div className="text-[11px] text-blue-800 bg-blue-50 border border-blue-200 px-3 py-2">
                    A receipt is already on file — <a href={`/uploads/${scanTarget.existing}?token=${localStorage.getItem('token')}`} target="_blank" rel="noopener noreferrer" className="font-bold underline">view existing</a>. Upload a new one to re-scan.
                  </div>
                )}

                {!scanResult && (
                  <>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-1">Bank Confirmation (PDF / JPG / PNG)</label>
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" onChange={e => setScanFile(e.target.files?.[0] || null)}
                        className="border border-slate-300 px-2 py-1.5 text-xs w-full" />
                      <div className="text-[10px] text-slate-400 mt-1">AI will read UTR, amount, beneficiary, bank and cross-check against this payment.</div>
                    </div>
                    <div className="flex gap-2 pt-2 border-t border-slate-200">
                      <button type="button" disabled={!scanFile || scanUploading}
                        onClick={async () => {
                          if (!scanFile) return;
                          setScanUploading(true);
                          const r = await scanBankReceipt(scanTarget.paymentId, scanFile);
                          setScanUploading(false);
                          if (r.ok) {
                            setScanResult({ extracted: r.extracted || null, warnings: r.warnings || [] });
                            fetchCompleted();
                            if (selectedPOId) {
                              try { const ref = await api.get(`/purchase-orders/${selectedPOId}`); setPODetail(ref.data); } catch { /* noop */ }
                            }
                          } else {
                            alert(`Scan failed: ${r.error}`);
                          }
                        }}
                        className="px-4 py-1.5 bg-purple-700 text-white text-[11px] font-bold uppercase hover:bg-purple-800 disabled:bg-slate-300 disabled:cursor-not-allowed inline-flex items-center gap-1">
                        <Scan size={11} /> {scanUploading ? 'Scanning…' : 'Upload & Scan'}
                      </button>
                      <button type="button" onClick={() => { setScanTarget(null); setScanFile(null); setScanResult(null); }}
                        className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                    </div>
                  </>
                )}

                {scanResult && (
                  <div className="space-y-3">
                    {scanResult.warnings.length > 0 ? (
                      <div className="border border-amber-300 bg-amber-50 px-3 py-2">
                        <div className="text-[10px] font-bold text-amber-800 uppercase tracking-widest mb-1">⚠ Cross-check warnings</div>
                        <ul className="list-disc list-inside text-[11px] text-amber-900 space-y-0.5">
                          {scanResult.warnings.map((w, i) => <li key={i}>{w}</li>)}
                        </ul>
                      </div>
                    ) : (
                      <div className="border border-green-300 bg-green-50 px-3 py-2 text-[11px] text-green-800">
                        ✓ Receipt extracted cleanly and matches the payment record.
                      </div>
                    )}
                    {scanResult.extracted && (
                      <div className="border border-slate-200">
                        <div className="bg-slate-800 text-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest">Extracted fields</div>
                        <table className="w-full text-[11px]">
                          <tbody>
                            {Object.entries(scanResult.extracted).filter(([, v]) => v !== null && v !== '' && v !== undefined).map(([k, v]) => (
                              <tr key={k} className="border-b border-slate-100">
                                <td className="px-3 py-1 text-slate-500 uppercase tracking-widest text-[9px] font-bold w-44">{k.replace(/_/g, ' ')}</td>
                                <td className="px-3 py-1 text-slate-900 font-mono select-all">{String(v)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <div className="flex gap-2 pt-2 border-t border-slate-200">
                      <button type="button" onClick={() => { setScanTarget(null); setScanFile(null); setScanResult(null); }}
                        className="px-4 py-1.5 bg-green-600 text-white text-[11px] font-bold uppercase hover:bg-green-700">Done</button>
                      <button type="button" onClick={() => { setScanFile(null); setScanResult(null); }}
                        className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Scan another</button>
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
