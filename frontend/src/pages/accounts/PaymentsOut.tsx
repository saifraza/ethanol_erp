import { useState, useEffect, useCallback, useMemo } from 'react';
import { CreditCard, FileText, Search, RefreshCw } from 'lucide-react';
import api from '../../services/api';
import PayDialog from '../../components/payments/PayDialog';
import VendorLedgerModal from '../../components/VendorLedgerModal';
import VendorPaymentDialog from '../../components/payments/VendorPaymentDialog';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

const fmtCurrency = (n: number) =>
  n === 0 ? '--' : '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });

const fmtDate = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const todayStr = () => new Date().toISOString().slice(0, 10);

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

type TabKey = 'ledger' | 'pending' | 'completed' | 'outstanding';

interface Vendor {
  id: string;
  name: string;
  gstin?: string | null;
  pan?: string | null;
}

interface VendorLedgerEntry {
  date: string;
  type: string;
  reference: string;
  debit: number;
  credit: number;
  runningBalance: number;
  info?: string;
}

interface PendingPayable {
  poId: string;
  poNo: number;
  poDate: string;
  poAmount: number;
  poStatus: string;
  vendorId: string;
  vendorName: string;
  grnDate: string | null;
  grnCount: number;
  paymentTerms: string | null;
  creditDays: number;
  dueDate: string | null;
  daysOverdue: number | null;
  urgency: 'green' | 'amber' | 'red' | 'none';
  invoiceStatus: 'NO_INVOICE' | 'PENDING' | 'PARTIAL_PAID' | 'PAID';
  totalInvoiced: number;
  totalPaid: number;
  balance: number;
  material: string | null;
  category: string | null;
}

interface PendingSummary {
  totalPayable: number;
  overdueAmount: number;
  dueThisWeek: number;
  paidThisMonth: number;
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
}

interface CompletedSummary {
  totalThisMonth: number;
  vendors: { total: number; count: number };
  transporters: { total: number; count: number };
  contractors: { total: number; count: number };
  cash: { total: number; count: number };
}

interface OutstandingItem {
  id: string;
  partyId: string;
  partyName: string;
  partyType: 'VENDOR' | 'CONTRACTOR';
  refNo: string;
  date: string;
  balanceAmount: number;
  daysOverdue: number;
}

interface VendorRollup {
  vendorId: string;
  vendorName: string;
  invoiceCount: number;
  totalOutstanding: number;
  oldestDays: number;
}

type SortDir = 'asc' | 'desc';

// ═══════════════════════════════════════════════
// Page
// ═══════════════════════════════════════════════

export default function PaymentsOut() {
  const [tab, setTab] = useState<TabKey>('ledger');

  // Vendor master (shared across tabs)
  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [vendorsLoading, setVendorsLoading] = useState(false);

  // Vendor Ledger tab state
  const [selectedVendorId, setSelectedVendorId] = useState<string>('');
  const [vendorSearch, setVendorSearch] = useState('');
  const [ledger, setLedger] = useState<VendorLedgerEntry[]>([]);
  const [ledgerBalance, setLedgerBalance] = useState(0);
  const [ledgerLoading, setLedgerLoading] = useState(false);

  // Pending tab state
  const [pending, setPending] = useState<PendingPayable[]>([]);
  const [pendingSummary, setPendingSummary] = useState<PendingSummary | null>(null);
  const [pendingLoading, setPendingLoading] = useState(false);
  const [pendingCategory, setPendingCategory] = useState<'ALL' | 'FUEL' | 'RAW_MATERIAL' | 'GENERAL'>('ALL');
  const [pendingSearch, setPendingSearch] = useState('');
  const [pendingFrom, setPendingFrom] = useState('');
  const [pendingTo, setPendingTo] = useState('');
  const [pendingSortKey, setPendingSortKey] = useState<keyof PendingPayable>('daysOverdue');
  const [pendingSortDir, setPendingSortDir] = useState<SortDir>('desc');

  // Completed tab state
  const [completed, setCompleted] = useState<OutPayment[]>([]);
  const [completedSummary, setCompletedSummary] = useState<CompletedSummary | null>(null);
  const [completedLoading, setCompletedLoading] = useState(false);
  const [completedType, setCompletedType] = useState<'' | 'VENDOR' | 'TRANSPORTER' | 'CONTRACTOR' | 'CASH'>('');
  const [completedMode, setCompletedMode] = useState<'' | 'CASH' | 'NEFT' | 'RTGS' | 'UPI' | 'CHEQUE'>('');
  const [completedFrom, setCompletedFrom] = useState('');
  const [completedTo, setCompletedTo] = useState('');
  const [completedSortKey, setCompletedSortKey] = useState<keyof OutPayment>('date');
  const [completedSortDir, setCompletedSortDir] = useState<SortDir>('desc');

  // Outstanding tab state
  const [outstandingRollup, setOutstandingRollup] = useState<VendorRollup[]>([]);
  const [outstandingLoading, setOutstandingLoading] = useState(false);

  // Modals
  const [payDialog, setPayDialog] = useState<PendingPayable | null>(null);
  const [vendorModalId, setVendorModalId] = useState<string | null>(null);
  const [recordPaymentVendor, setRecordPaymentVendor] = useState<{ id: string; name: string } | null>(null);

  // ── Fetchers ──────────────────────────────────

  const fetchVendors = useCallback(async () => {
    try {
      setVendorsLoading(true);
      const res = await api.get<{ vendors: Vendor[] } | Vendor[]>('/vendors');
      const list = Array.isArray(res.data) ? res.data : (res.data.vendors || []);
      setVendors(list.slice().sort((a, b) => a.name.localeCompare(b.name)));
    } catch (err) {
      console.error('Failed to load vendors', err);
    } finally {
      setVendorsLoading(false);
    }
  }, []);

  const fetchLedger = useCallback(async (vendorId: string) => {
    if (!vendorId) {
      setLedger([]);
      setLedgerBalance(0);
      return;
    }
    try {
      setLedgerLoading(true);
      const res = await api.get<{ ledger: VendorLedgerEntry[]; currentBalance: number }>(
        `/vendor-payments/ledger/${vendorId}`,
      );
      setLedger(res.data.ledger || []);
      setLedgerBalance(res.data.currentBalance || 0);
    } catch (err) {
      console.error('Failed to load ledger', err);
      setLedger([]);
      setLedgerBalance(0);
    } finally {
      setLedgerLoading(false);
    }
  }, []);

  const fetchPending = useCallback(async () => {
    try {
      setPendingLoading(true);
      const [listRes, sumRes] = await Promise.all([
        api.get<{ items: PendingPayable[] }>('/unified-payments/outgoing/pending'),
        api.get<PendingSummary>('/unified-payments/outgoing/pending-summary'),
      ]);
      setPending(listRes.data.items || []);
      setPendingSummary(sumRes.data);
    } catch (err) {
      console.error('Failed to load pending payables', err);
    } finally {
      setPendingLoading(false);
    }
  }, []);

  const fetchCompleted = useCallback(async () => {
    try {
      setCompletedLoading(true);
      const params: Record<string, string> = {};
      if (completedType) params.type = completedType;
      if (completedMode) params.mode = completedMode;
      if (completedFrom) params.from = completedFrom;
      if (completedTo) params.to = completedTo;
      const qs = new URLSearchParams(params).toString();
      const [listRes, sumRes] = await Promise.all([
        api.get<{ items: OutPayment[]; total: number }>(`/unified-payments/outgoing${qs ? '?' + qs : ''}`),
        api.get<CompletedSummary>('/unified-payments/outgoing/summary'),
      ]);
      setCompleted(listRes.data.items || []);
      setCompletedSummary(sumRes.data);
    } catch (err) {
      console.error('Failed to load completed payments', err);
    } finally {
      setCompletedLoading(false);
    }
  }, [completedType, completedMode, completedFrom, completedTo]);

  const fetchOutstanding = useCallback(async () => {
    try {
      setOutstandingLoading(true);
      const res = await api.get<{ items: OutstandingItem[] }>('/unified-payments/outgoing/outstanding');
      const items = res.data.items || [];
      // Roll up to vendor level (skip non-vendor parties for the vendor-ledger flow).
      const map = new Map<string, VendorRollup>();
      for (const it of items) {
        if (it.partyType !== 'VENDOR') continue;
        const cur = map.get(it.partyId);
        if (cur) {
          cur.invoiceCount += 1;
          cur.totalOutstanding += it.balanceAmount || 0;
          cur.oldestDays = Math.max(cur.oldestDays, it.daysOverdue || 0);
        } else {
          map.set(it.partyId, {
            vendorId: it.partyId,
            vendorName: it.partyName,
            invoiceCount: 1,
            totalOutstanding: it.balanceAmount || 0,
            oldestDays: it.daysOverdue || 0,
          });
        }
      }
      const rollup = Array.from(map.values()).sort((a, b) => b.totalOutstanding - a.totalOutstanding);
      setOutstandingRollup(rollup);
    } catch (err) {
      console.error('Failed to load outstanding', err);
    } finally {
      setOutstandingLoading(false);
    }
  }, []);

  // ── Effects ──────────────────────────────────

  useEffect(() => {
    fetchVendors();
  }, [fetchVendors]);

  useEffect(() => {
    if (tab === 'ledger' && selectedVendorId) fetchLedger(selectedVendorId);
  }, [tab, selectedVendorId, fetchLedger]);

  useEffect(() => {
    if (tab === 'pending') fetchPending();
  }, [tab, fetchPending]);

  useEffect(() => {
    if (tab === 'completed') fetchCompleted();
  }, [tab, fetchCompleted]);

  useEffect(() => {
    if (tab === 'outstanding') fetchOutstanding();
  }, [tab, fetchOutstanding]);

  // ── Derived ──────────────────────────────────

  const filteredVendors = useMemo(() => {
    const q = vendorSearch.trim().toLowerCase();
    if (!q) return vendors;
    return vendors.filter(v => v.name.toLowerCase().includes(q));
  }, [vendors, vendorSearch]);

  const ledgerTotals = useMemo(() => {
    return ledger.reduce(
      (acc, l) => ({ debit: acc.debit + (l.debit || 0), credit: acc.credit + (l.credit || 0) }),
      { debit: 0, credit: 0 },
    );
  }, [ledger]);

  const filteredPending = useMemo(() => {
    const q = pendingSearch.trim().toLowerCase();
    const stripped = q.replace(/^po-?/, '');
    return pending
      .filter(p => {
        if (pendingCategory !== 'ALL' && (p.category || 'GENERAL') !== pendingCategory) return false;
        if (pendingFrom && p.poDate < pendingFrom) return false;
        if (pendingTo && p.poDate > pendingTo + 'T23:59:59') return false;
        if (q) {
          const haystack = `${p.vendorName} ${p.material || ''} ${p.poNo}`.toLowerCase();
          if (!haystack.includes(q) && !String(p.poNo).includes(stripped)) return false;
        }
        return true;
      })
      .slice()
      .sort((a, b) => sortCompare(a, b, pendingSortKey, pendingSortDir));
  }, [pending, pendingCategory, pendingSearch, pendingFrom, pendingTo, pendingSortKey, pendingSortDir]);

  const filteredCompleted = useMemo(() => {
    return completed.slice().sort((a, b) => sortCompare(a, b, completedSortKey, completedSortDir));
  }, [completed, completedSortKey, completedSortDir]);

  const overdueCount = pendingSummary?.agingCount.overdue || 0;
  const pendingVendorCount = useMemo(() => new Set(pending.map(p => p.vendorId)).size, [pending]);

  // ── Handlers ──────────────────────────────────

  const togglePendingSort = (key: keyof PendingPayable) => {
    if (pendingSortKey === key) setPendingSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setPendingSortKey(key); setPendingSortDir('desc'); }
  };

  const toggleCompletedSort = (key: keyof OutPayment) => {
    if (completedSortKey === key) setCompletedSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    else { setCompletedSortKey(key); setCompletedSortDir('desc'); }
  };

  const openVendorLedger = (vendorId: string) => {
    setSelectedVendorId(vendorId);
    setVendorSearch('');
    setTab('ledger');
  };

  // ── Render ──────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Title strip */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Payments Out</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Vendor ledger · Pending payables · Completed payments</span>
          </div>
          <button
            onClick={() => {
              if (tab === 'ledger' && selectedVendorId) fetchLedger(selectedVendorId);
              else if (tab === 'pending') fetchPending();
              else if (tab === 'completed') fetchCompleted();
              else if (tab === 'outstanding') fetchOutstanding();
            }}
            className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[11px] font-medium uppercase tracking-widest flex items-center gap-1.5"
          >
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
        </div>

        {/* Tabs */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 flex">
          <TabBtn active={tab === 'ledger'} onClick={() => setTab('ledger')}>Vendor Ledger</TabBtn>
          <TabBtn active={tab === 'pending'} onClick={() => setTab('pending')}>
            Pending {pending.length > 0 && <Badge>{pending.length}</Badge>}
          </TabBtn>
          <TabBtn active={tab === 'completed'} onClick={() => setTab('completed')}>Completed</TabBtn>
          <TabBtn active={tab === 'outstanding'} onClick={() => setTab('outstanding')}>
            Outstanding {outstandingRollup.length > 0 && <Badge>{outstandingRollup.length}</Badge>}
          </TabBtn>
        </div>

        {/* ═══ Tab: Vendor Ledger ═══ */}
        {tab === 'ledger' && (
          <>
            {/* Vendor selector */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vendor</label>
              <div className="relative">
                <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={vendorSearch}
                  onChange={(e) => setVendorSearch(e.target.value)}
                  placeholder="Search vendor..."
                  className="border border-slate-300 pl-7 pr-2 py-1.5 text-xs w-56 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <select
                value={selectedVendorId}
                onChange={(e) => setSelectedVendorId(e.target.value)}
                className="border border-slate-300 px-2 py-1.5 text-xs min-w-[280px] focus:outline-none focus:ring-1 focus:ring-slate-400"
                disabled={vendorsLoading}
              >
                <option value="">{vendorsLoading ? 'Loading vendors...' : `Select vendor (${filteredVendors.length})`}</option>
                {filteredVendors.map(v => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
              {selectedVendorId && (
                <>
                  <button
                    onClick={() => {
                      const v = filteredVendors.find((x) => x.id === selectedVendorId);
                      if (v) setRecordPaymentVendor({ id: v.id, name: v.name });
                    }}
                    className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest bg-blue-600 text-white hover:bg-blue-700"
                  >
                    + Record Payment
                  </button>
                  <button
                    onClick={() => { setSelectedVendorId(''); setLedger([]); setLedgerBalance(0); }}
                    className="text-[10px] text-slate-500 uppercase tracking-widest hover:text-slate-800"
                  >
                    Clear
                  </button>
                </>
              )}
            </div>

            {/* KPIs */}
            {selectedVendorId && (
              <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
                <KpiCard label="Total Invoiced" value={fmtCurrency(ledgerTotals.debit)} accent="border-l-blue-500" />
                <KpiCard label="Total Paid" value={fmtCurrency(ledgerTotals.credit)} accent="border-l-green-500" valueClass="text-green-700" />
                <KpiCard
                  label="Current Balance"
                  value={fmtCurrency(ledgerBalance)}
                  accent={ledgerBalance > 0 ? 'border-l-red-500' : 'border-l-slate-400'}
                  valueClass={ledgerBalance > 0 ? 'text-red-700' : 'text-slate-500'}
                />
              </div>
            )}

            {/* Ledger table */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto bg-white">
              {!selectedVendorId ? (
                <div className="p-10 text-center text-xs text-slate-400 uppercase tracking-widest">
                  Select a vendor above to view their running ledger.
                </div>
              ) : ledgerLoading ? (
                <div className="p-10 text-center text-xs text-slate-400 uppercase tracking-widest">Loading ledger...</div>
              ) : ledger.length === 0 ? (
                <div className="p-10 text-center text-xs text-slate-400 uppercase tracking-widest">No ledger entries for this vendor.</div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <Th>Date</Th>
                      <Th>Type</Th>
                      <Th>Reference</Th>
                      <Th>Particulars</Th>
                      <Th align="right">Debit</Th>
                      <Th align="right">Credit</Th>
                      <Th align="right">Running Balance</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.map((l, i) => (
                      <tr key={i} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(l.date)}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <TypePill type={l.type} />
                        </td>
                        <td className="px-3 py-1.5 font-mono tabular-nums border-r border-slate-100">{l.reference || '—'}</td>
                        <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{l.info || '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{l.debit ? fmtCurrency(l.debit) : '—'}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-green-700 border-r border-slate-100">{l.credit ? fmtCurrency(l.credit) : '—'}</td>
                        <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-bold ${l.runningBalance > 0 ? 'text-red-600' : 'text-slate-500'}`}>
                          {fmtCurrency(l.runningBalance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-semibold sticky bottom-0">
                      <td colSpan={4} className="px-3 py-1.5 text-[10px] uppercase tracking-widest border-r border-slate-700">Total</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(ledgerTotals.debit)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(ledgerTotals.credit)}</td>
                      <td className={`px-3 py-1.5 text-right font-mono tabular-nums ${ledgerBalance > 0 ? 'text-red-300' : ''}`}>{fmtCurrency(ledgerBalance)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </>
        )}

        {/* ═══ Tab: Pending ═══ */}
        {tab === 'pending' && (
          <>
            {/* Filter strip */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Category</label>
              <select
                value={pendingCategory}
                onChange={(e) => setPendingCategory(e.target.value as typeof pendingCategory)}
                className="border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="ALL">All</option>
                <option value="FUEL">Fuel</option>
                <option value="RAW_MATERIAL">Raw Material</option>
                <option value="GENERAL">General</option>
              </select>
              <div className="relative">
                <Search className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={pendingSearch}
                  onChange={(e) => setPendingSearch(e.target.value)}
                  placeholder="Vendor, PO# or material..."
                  className="border border-slate-300 pl-7 pr-2 py-1.5 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">From</label>
              <input type="date" value={pendingFrom} onChange={(e) => setPendingFrom(e.target.value)}
                className="border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">To</label>
              <input type="date" value={pendingTo} onChange={(e) => setPendingTo(e.target.value)} max={todayStr()}
                className="border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
              <span className="text-[10px] text-slate-400 uppercase tracking-widest ml-auto">
                {pendingLoading ? 'Loading...' : `${filteredPending.length} of ${pending.length} POs`}
              </span>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
              <KpiCard label="Total Pending POs" value={String(pending.length)} accent="border-l-blue-500" mono />
              <KpiCard label="Total Outstanding" value={fmtCurrency(pendingSummary?.totalPayable || 0)} accent="border-l-amber-500" />
              <KpiCard label="Overdue" value={String(overdueCount)} accent="border-l-red-500" mono valueClass="text-red-700" />
              <KpiCard label="Vendors" value={String(pendingVendorCount)} accent="border-l-slate-400" mono />
            </div>

            {/* Table */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <SortTh active={pendingSortKey === 'poNo'} dir={pendingSortDir} onClick={() => togglePendingSort('poNo')}>PO#</SortTh>
                    <SortTh active={pendingSortKey === 'vendorName'} dir={pendingSortDir} onClick={() => togglePendingSort('vendorName')}>Vendor</SortTh>
                    <Th>Material</Th>
                    <SortTh active={pendingSortKey === 'poDate'} dir={pendingSortDir} onClick={() => togglePendingSort('poDate')}>PO Date</SortTh>
                    <Th>Terms</Th>
                    <SortTh align="right" active={pendingSortKey === 'poAmount'} dir={pendingSortDir} onClick={() => togglePendingSort('poAmount')}>PO Amount</SortTh>
                    <Th>GRN Date</Th>
                    <SortTh align="right" active={pendingSortKey === 'daysOverdue'} dir={pendingSortDir} onClick={() => togglePendingSort('daysOverdue')}>Days Over</SortTh>
                    <SortTh align="right" active={pendingSortKey === 'balance'} dir={pendingSortDir} onClick={() => togglePendingSort('balance')}>Outstanding</SortTh>
                    <Th align="center">Action</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredPending.length === 0 ? (
                    <tr><td colSpan={10} className="px-3 py-10 text-center text-xs text-slate-400 uppercase tracking-widest">
                      {pendingLoading ? 'Loading...' : 'No pending POs match these filters.'}
                    </td></tr>
                  ) : filteredPending.map((p, i) => {
                    const overdue = (p.daysOverdue || 0) > 0;
                    return (
                      <tr key={p.poId} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-3 py-1.5 font-mono tabular-nums text-slate-600 border-r border-slate-100">PO-{p.poNo}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <button onClick={() => setVendorModalId(p.vendorId)} className="text-blue-700 hover:underline font-semibold text-left">
                            {p.vendorName}
                          </button>
                        </td>
                        <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{p.material || '—'}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(p.poDate)}</td>
                        <td className="px-3 py-1.5 text-[10px] text-slate-500 uppercase border-r border-slate-100">
                          {p.paymentTerms || (p.creditDays ? `NET${p.creditDays}` : '—')}
                        </td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCurrency(p.poAmount)}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(p.grnDate)}</td>
                        <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 ${overdue ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                          {p.daysOverdue !== null ? p.daysOverdue : '—'}
                        </td>
                        <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100 ${p.balance > 0 ? 'text-red-700' : 'text-slate-400'}`}>
                          {fmtCurrency(p.balance)}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <button
                            onClick={() => setPayDialog(p)}
                            disabled={p.balance <= 0}
                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-1"
                          >
                            <CreditCard className="w-3 h-3" /> Pay
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ═══ Tab: Completed ═══ */}
        {tab === 'completed' && (
          <>
            {/* Filter strip */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Type</label>
              <select
                value={completedType}
                onChange={(e) => setCompletedType(e.target.value as typeof completedType)}
                className="border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="">All</option>
                <option value="VENDOR">Vendor</option>
                <option value="TRANSPORTER">Transporter</option>
                <option value="CONTRACTOR">Contractor</option>
                <option value="CASH">Cash</option>
              </select>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Mode</label>
              <select
                value={completedMode}
                onChange={(e) => setCompletedMode(e.target.value as typeof completedMode)}
                className="border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
              >
                <option value="">All</option>
                <option value="CASH">Cash</option>
                <option value="NEFT">NEFT</option>
                <option value="RTGS">RTGS</option>
                <option value="UPI">UPI</option>
                <option value="CHEQUE">Cheque</option>
              </select>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">From</label>
              <input type="date" value={completedFrom} onChange={(e) => setCompletedFrom(e.target.value)}
                className="border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">To</label>
              <input type="date" value={completedTo} onChange={(e) => setCompletedTo(e.target.value)} max={todayStr()}
                className="border border-slate-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
              <span className="text-[10px] text-slate-400 uppercase tracking-widest ml-auto">
                {completedLoading ? 'Loading...' : `${completed.length} payments`}
              </span>
            </div>

            {/* KPI strip */}
            <div className="grid grid-cols-5 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
              <KpiCard label="This Month" value={fmtCurrency(completedSummary?.totalThisMonth || 0)} accent="border-l-blue-500" />
              <KpiCard label="Vendors" value={fmtCurrency(completedSummary?.vendors.total || 0)} accent="border-l-slate-400" sub={`${completedSummary?.vendors.count || 0} pmts`} />
              <KpiCard label="Transporters" value={fmtCurrency(completedSummary?.transporters.total || 0)} accent="border-l-slate-400" sub={`${completedSummary?.transporters.count || 0} pmts`} />
              <KpiCard label="Contractors" value={fmtCurrency(completedSummary?.contractors.total || 0)} accent="border-l-slate-400" sub={`${completedSummary?.contractors.count || 0} pmts`} />
              <KpiCard label="Cash" value={fmtCurrency(completedSummary?.cash.total || 0)} accent="border-l-emerald-500" sub={`${completedSummary?.cash.count || 0} vouchers`} />
            </div>

            {/* Table */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <SortTh active={completedSortKey === 'date'} dir={completedSortDir} onClick={() => toggleCompletedSort('date')}>Date</SortTh>
                    <SortTh active={completedSortKey === 'payeeType'} dir={completedSortDir} onClick={() => toggleCompletedSort('payeeType')}>Type</SortTh>
                    <SortTh active={completedSortKey === 'payee'} dir={completedSortDir} onClick={() => toggleCompletedSort('payee')}>Payee</SortTh>
                    <SortTh align="right" active={completedSortKey === 'amount'} dir={completedSortDir} onClick={() => toggleCompletedSort('amount')}>Amount</SortTh>
                    <SortTh active={completedSortKey === 'mode'} dir={completedSortDir} onClick={() => toggleCompletedSort('mode')}>Mode</SortTh>
                    <Th>Reference</Th>
                    <Th>Source</Th>
                    <Th>Remarks</Th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCompleted.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-10 text-center text-xs text-slate-400 uppercase tracking-widest">
                      {completedLoading ? 'Loading...' : 'No payments match these filters.'}
                    </td></tr>
                  ) : filteredCompleted.map((p, i) => (
                    <tr key={p.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(p.date)}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <PayeeTypePill t={p.payeeType} />
                      </td>
                      <td className="px-3 py-1.5 font-semibold text-slate-800 border-r border-slate-100">{p.payee}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100">{fmtCurrency(p.amount)}</td>
                      <td className="px-3 py-1.5 text-[10px] uppercase tracking-widest text-slate-600 border-r border-slate-100">{p.mode}</td>
                      <td className="px-3 py-1.5 font-mono tabular-nums text-slate-600 border-r border-slate-100">{p.reference || '—'}</td>
                      <td className="px-3 py-1.5 text-[10px] text-slate-500 border-r border-slate-100">{p.sourceRef || p.source}</td>
                      <td className="px-3 py-1.5 text-slate-500 truncate max-w-[260px]" title={p.remarks || ''}>{p.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ═══ Tab: Outstanding ═══ */}
        {tab === 'outstanding' && (
          <>
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center gap-3">
              <FileText className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[10px] text-slate-500 uppercase tracking-widest">
                Vendor-level rollup of unpaid invoices. Click a vendor name to open their full ledger.
              </span>
              <span className="text-[10px] text-slate-400 uppercase tracking-widest ml-auto">
                {outstandingLoading ? 'Loading...' : `${outstandingRollup.length} vendors`}
              </span>
            </div>

            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <Th>Vendor Name</Th>
                    <Th align="right">Invoice Count</Th>
                    <Th align="right">Oldest Days Overdue</Th>
                    <Th align="right">Total Outstanding</Th>
                  </tr>
                </thead>
                <tbody>
                  {outstandingRollup.length === 0 ? (
                    <tr><td colSpan={4} className="px-3 py-10 text-center text-xs text-slate-400 uppercase tracking-widest">
                      {outstandingLoading ? 'Loading...' : 'No vendor outstanding balances.'}
                    </td></tr>
                  ) : outstandingRollup.map((v, i) => (
                    <tr key={v.vendorId} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <button onClick={() => openVendorLedger(v.vendorId)} className="text-blue-700 hover:underline font-semibold">
                          {v.vendorName}
                        </button>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{v.invoiceCount}</td>
                      <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 ${v.oldestDays > 30 ? 'text-red-600 font-bold' : 'text-slate-500'}`}>
                        {v.oldestDays}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-red-700">{fmtCurrency(v.totalOutstanding)}</td>
                    </tr>
                  ))}
                </tbody>
                {outstandingRollup.length > 0 && (
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-semibold">
                      <td className="px-3 py-1.5 text-[10px] uppercase tracking-widest border-r border-slate-700">Total</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-700">
                        {outstandingRollup.reduce((s, v) => s + v.invoiceCount, 0)}
                      </td>
                      <td className="px-3 py-1.5 border-r border-slate-700"></td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-red-300">
                        {fmtCurrency(outstandingRollup.reduce((s, v) => s + v.totalOutstanding, 0))}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </>
        )}
      </div>

      {/* Pay dialog */}
      {payDialog && (
        <PayDialog
          poId={payDialog.poId}
          poNo={payDialog.poNo}
          vendorName={payDialog.vendorName}
          subtitle={payDialog.material || payDialog.category || undefined}
          outstanding={payDialog.balance}
          surface="generic"
          fmtCurrency={fmtCurrency}
          onClose={() => setPayDialog(null)}
          onPaid={() => {
            const vid = payDialog.vendorId;
            setPayDialog(null);
            fetchPending();
            // If the user is also viewing this vendor's ledger, refresh it.
            if (selectedVendorId === vid) fetchLedger(vid);
          }}
          onOpenVendorLedger={() => setVendorModalId(payDialog.vendorId)}
        />
      )}

      {/* Vendor ledger modal */}
      {vendorModalId && (
        <VendorLedgerModal
          vendorId={vendorModalId}
          onClose={() => setVendorModalId(null)}
        />
      )}

      {/* Record payment from the Vendor Ledger tab */}
      {recordPaymentVendor && (
        <VendorPaymentDialog
          vendorId={recordPaymentVendor.id}
          vendorName={recordPaymentVendor.name}
          fmtCurrency={fmtCurrency}
          onClose={() => setRecordPaymentVendor(null)}
          onSaved={() => {
            const vid = recordPaymentVendor.id;
            setRecordPaymentVendor(null);
            // Refetch the ledger and pending list so the new payment appears.
            if (selectedVendorId === vid) fetchLedger(vid);
            fetchPending();
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════
// Subcomponents
// ═══════════════════════════════════════════════

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-5 py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 ${active ? 'border-blue-600 text-slate-800' : 'border-transparent text-slate-400 hover:text-slate-600'}`}
    >
      {children}
    </button>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return <span className="ml-1 bg-orange-500 text-white text-[9px] px-1.5 py-0.5">{children}</span>;
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  const a = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`${a} px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 last:border-r-0`}>
      {children}
    </th>
  );
}

function SortTh({
  children,
  active,
  dir,
  align = 'left',
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  dir: SortDir;
  align?: 'left' | 'right' | 'center';
  onClick: () => void;
}) {
  const a = align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left';
  return (
    <th className={`${a} px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 last:border-r-0 cursor-pointer select-none hover:bg-slate-700`}
        onClick={onClick}>
      {children}
      {active && <span className="ml-1 text-slate-400">{dir === 'asc' ? '↑' : '↓'}</span>}
    </th>
  );
}

function KpiCard({
  label,
  value,
  accent,
  valueClass,
  sub,
  mono = false,
}: {
  label: string;
  value: string;
  accent: string;
  valueClass?: string;
  sub?: string;
  mono?: boolean;
}) {
  return (
    <div className={`bg-white px-4 py-3 border-r border-slate-300 last:border-r-0 border-l-4 ${accent}`}>
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</div>
      <div className={`text-lg font-bold mt-0.5 font-mono tabular-nums ${valueClass || 'text-slate-800'} ${mono ? '' : ''}`}>{value}</div>
      {sub && <div className="text-[10px] text-slate-400 mt-0.5">{sub}</div>}
    </div>
  );
}

function TypePill({ type }: { type: string }) {
  const cls = (() => {
    if (type === 'PO') return 'border-slate-300 bg-slate-50 text-slate-600';
    if (type === 'INVOICE') return 'border-blue-300 bg-blue-50 text-blue-700';
    if (type === 'PAYMENT') return 'border-green-300 bg-green-50 text-green-700';
    if (type === 'CASH PAYMENT' || type === 'CASH_VOUCHER') return 'border-emerald-300 bg-emerald-50 text-emerald-700';
    if (type === 'JOURNAL') return 'border-purple-300 bg-purple-50 text-purple-700';
    return 'border-slate-300 bg-slate-50 text-slate-600';
  })();
  return <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${cls}`}>{type}</span>;
}

function PayeeTypePill({ t }: { t: OutPayment['payeeType'] }) {
  const cls =
    t === 'VENDOR' ? 'border-blue-300 bg-blue-50 text-blue-700' :
    t === 'TRANSPORTER' ? 'border-amber-300 bg-amber-50 text-amber-700' :
    t === 'CASH' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' :
    'border-slate-300 bg-slate-50 text-slate-600';
  return <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${cls}`}>{t}</span>;
}

// ═══════════════════════════════════════════════
// Sort utils
// ═══════════════════════════════════════════════

function sortCompare<T>(a: T, b: T, key: keyof T, dir: SortDir): number {
  const av = a[key];
  const bv = b[key];
  let cmp: number;
  if (av == null && bv == null) cmp = 0;
  else if (av == null) cmp = -1;
  else if (bv == null) cmp = 1;
  else if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  return dir === 'asc' ? cmp : -cmp;
}
