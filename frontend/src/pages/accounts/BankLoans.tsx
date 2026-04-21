import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import api from '../../services/api';

// ── Types ──

interface LoanRepayment {
  id: string;
  installmentNo: number;
  dueDate: string;
  principalAmount: number;
  interestAmount: number;
  totalAmount: number;
  outstandingAfter: number;
  status: string;
  paidDate: string | null;
  paymentMode: string | null;
  paymentRef: string | null;
}

interface BankLoan {
  id: string;
  loanNo: string;
  bankName: string;
  bankAccountCode: string | null;
  loanType: string;
  repaymentFrequency: string;
  sanctionAmount: number;
  disbursedAmount: number;
  outstandingAmount: number;
  interestRate: number;
  tenure: number;
  emiAmount: number;
  sanctionDate: string;
  disbursementDate: string | null;
  maturityDate: string | null;
  status: string;
  securityDetails: string | null;
  remarks: string | null;
  repayments: LoanRepayment[];
  repaymentSummary?: { paidCount: number; totalCount: number; nextDueDate: string | null; nextDueAmount: number | null };
  createdAt: string;
}

interface TypeBreakdown {
  loanType: string;
  label: string;
  count: number;
  outstanding: number;
  sanctioned: number;
  monthlyOutflow: number;
}

interface LoanSummary {
  totalSanctioned: number;
  totalOutstanding: number;
  utilizationPercent: number;
  monthlyOutflow: number;
  weightedAvgRate: number;
  activeCount: number;
  closedCount: number;
  totalCount: number;
  securedOutstanding: number;
  unsecuredOutstanding: number;
  byType: TypeBreakdown[];
  rateBands: Array<{ band: string; count: number; outstanding: number }>;
  upcomingOutflows: Array<{ month: string; totalOutflow: number; principal: number; interest: number; TERM_LOAN: number; WORKING_CAPITAL: number; EQUIPMENT: number; CC_LIMIT: number; count: number }>;
  nextPayment: { dueDate: string; amount: number; bankName: string; loanNo: string; frequency: string } | null;
}

// ── Constants ──

const LOAN_TYPES = [
  { value: 'TERM_LOAN', label: 'Term Loan' },
  { value: 'WORKING_CAPITAL', label: 'Working Capital' },
  { value: 'CC_LIMIT', label: 'CC Limit' },
  { value: 'EQUIPMENT', label: 'Vehicle / Equipment' },
];

const FREQ_OPTIONS = [
  { value: 'MONTHLY', label: 'Monthly' },
  { value: 'QUARTERLY', label: 'Quarterly' },
  { value: 'HALF_YEARLY', label: 'Half-Yearly' },
  { value: 'BULLET', label: 'Bullet' },
  { value: 'NONE', label: 'None (Interest Only)' },
];

const PAYMENT_MODES = [
  { value: 'NEFT', label: 'NEFT' },
  { value: 'RTGS', label: 'RTGS' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'AUTO_DEBIT', label: 'Auto Debit' },
  { value: 'UPI', label: 'UPI' },
];

const TYPE_COLORS: Record<string, string> = {
  TERM_LOAN: '#334155',    // slate-700
  WORKING_CAPITAL: '#f59e0b', // amber-500
  CC_LIMIT: '#6366f1',     // indigo-500
  EQUIPMENT: '#3b82f6',    // blue-500
};

// Display groups for the table
type DisplayGroup = 'TERM_LOAN' | 'CC_PLEDGE' | 'VEHICLE' | 'BUSINESS';
const DISPLAY_GROUPS: Array<{ key: DisplayGroup; label: string; color: string }> = [
  { key: 'TERM_LOAN', label: 'TERM LOANS', color: 'border-l-slate-700' },
  { key: 'CC_PLEDGE', label: 'CC / PLEDGE / WAREHOUSE', color: 'border-l-indigo-500' },
  { key: 'VEHICLE', label: 'VEHICLE / EQUIPMENT', color: 'border-l-blue-500' },
  { key: 'BUSINESS', label: 'BUSINESS LOANS (UNSECURED)', color: 'border-l-amber-500' },
];

const FILTER_TABS = [
  { key: 'ALL', label: 'All' },
  { key: 'TERM_LOAN', label: 'Term Loan' },
  { key: 'CC_PLEDGE', label: 'CC / Pledge' },
  { key: 'VEHICLE', label: 'Vehicle' },
  { key: 'BUSINESS', label: 'Business' },
];

// ── Formatting ──

function fmtINR(n: number): string {
  if (n === 0) return '--';
  const abs = Math.abs(n);
  if (abs >= 1_00_00_000) return '\u20B9' + (n / 1_00_00_000).toFixed(2) + ' Cr';
  if (abs >= 1_00_000) return '\u20B9' + (n / 1_00_000).toFixed(2) + ' L';
  return '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function fmtDate(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtTenure(months: number): string {
  if (months <= 0) return '--';
  const y = Math.floor(months / 12);
  const m = months % 12;
  if (y === 0) return `${m}mo`;
  if (m === 0) return `${y}yr`;
  return `${y}yr ${m}mo`;
}

function remainingMonths(maturityDate: string | null): number {
  if (!maturityDate) return 0;
  const now = new Date();
  const mat = new Date(maturityDate);
  const diff = (mat.getFullYear() - now.getFullYear()) * 12 + (mat.getMonth() - now.getMonth());
  return Math.max(0, diff);
}

function freqBadge(f: string): { label: string; cls: string } {
  switch (f) {
    case 'MONTHLY': return { label: 'M', cls: 'border-blue-400 bg-blue-50 text-blue-600' };
    case 'QUARTERLY': return { label: 'Q', cls: 'border-amber-400 bg-amber-50 text-amber-700' };
    case 'HALF_YEARLY': return { label: 'H', cls: 'border-purple-400 bg-purple-50 text-purple-600' };
    case 'NONE': return { label: '--', cls: 'border-slate-300 bg-slate-50 text-slate-400' };
    default: return { label: f[0] || '?', cls: 'border-slate-300 bg-slate-50 text-slate-500' };
  }
}

function rateColor(rate: number): string {
  if (rate < 10) return 'text-green-700';
  if (rate <= 14) return 'text-amber-600';
  return 'text-red-600';
}

function loanTypeLabel(t: string): string {
  return LOAN_TYPES.find((lt) => lt.value === t)?.label || t;
}

function getDisplayGroup(loan: BankLoan): DisplayGroup {
  if (loan.loanType === 'TERM_LOAN') return 'TERM_LOAN';
  if (loan.loanType === 'EQUIPMENT') return 'VEHICLE';
  if (loan.loanType === 'CC_LIMIT') return 'CC_PLEDGE';
  // WORKING_CAPITAL: split by collateral
  const sec = (loan.securityDetails || '').toUpperCase();
  if (sec.includes('STOCK') || sec.includes('UNSECURED') === false) {
    // If it's pledge/warehouse (STOCK collateral) or other secured WC
    if (sec.includes('UNSECURED')) return 'BUSINESS';
    if (sec === '' || sec === 'NONE') return 'BUSINESS'; // no security = unsecured business
    return 'CC_PLEDGE';
  }
  return 'BUSINESS';
}

const statusBadge = (s: string) => {
  const colors: Record<string, string> = {
    ACTIVE: 'border-green-500 bg-green-50 text-green-700',
    CLOSED: 'border-slate-400 bg-slate-100 text-slate-500',
    RESTRUCTURED: 'border-amber-500 bg-amber-50 text-amber-700',
  };
  return colors[s] || 'border-slate-300 bg-slate-50 text-slate-600';
};

// ── Form Interfaces ──

interface NewLoanForm {
  loanNo: string;
  bankName: string;
  loanType: string;
  repaymentFrequency: string;
  sanctionAmount: string;
  interestRate: string;
  tenure: string;
  sanctionDate: string;
  disbursementDate: string;
  securityDetails: string;
  remarks: string;
}

const emptyLoanForm: NewLoanForm = {
  loanNo: '', bankName: '', loanType: 'TERM_LOAN', repaymentFrequency: 'MONTHLY',
  sanctionAmount: '', interestRate: '', tenure: '', sanctionDate: '', disbursementDate: '',
  securityDetails: '', remarks: '',
};

interface PaymentForm {
  paymentMode: string;
  paymentRef: string;
  paidDate: string;
  remarks: string;
}

const emptyPaymentForm: PaymentForm = {
  paymentMode: 'NEFT', paymentRef: '', paidDate: new Date().toISOString().split('T')[0], remarks: '',
};

// ── Custom Tooltip for charts ──

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-slate-800 text-white px-3 py-1.5 text-[10px] shadow-lg border border-slate-700">
      <div className="font-bold">{label || payload[0]?.name}</div>
      <div className="font-mono">{fmtINR(payload[0]?.value || 0)}</div>
    </div>
  );
}

function StackedTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const total = payload.reduce((s: number, p: any) => s + (p.value || 0), 0);
  return (
    <div className="bg-slate-800 text-white px-3 py-2 text-[10px] shadow-lg border border-slate-700 min-w-[180px]">
      <div className="font-bold mb-1 border-b border-slate-600 pb-1">{label}</div>
      {payload.filter((p: any) => p.value > 0).map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>● {p.dataKey.replace('_', ' ')}</span>
          <span className="font-mono">{fmtINR(p.value)}</span>
        </div>
      ))}
      <div className="border-t border-slate-600 mt-1 pt-1 flex justify-between font-bold">
        <span>Total</span>
        <span className="font-mono">{fmtINR(total)}</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════

export default function BankLoans() {
  const [loans, setLoans] = useState<BankLoan[]>([]);
  const [summary, setSummary] = useState<LoanSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);
  const [expandedLoan, setExpandedLoan] = useState<BankLoan | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  // Modals
  const [showNewLoan, setShowNewLoan] = useState(false);
  const [loanForm, setLoanForm] = useState<NewLoanForm>(emptyLoanForm);
  const [loanSaving, setLoanSaving] = useState(false);
  const [showPayment, setShowPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<{ loanId: string; repaymentId: string; installmentNo: number; amount: number } | null>(null);

  // ── Data Fetching ──

  const fetchLoans = useCallback(async () => {
    try {
      setLoading(true);
      const [loansRes, summaryRes] = await Promise.all([
        api.get<BankLoan[]>('/bank-loans'),
        api.get<LoanSummary>('/bank-loans/summary'),
      ]);
      setLoans(loansRes.data);
      setSummary(summaryRes.data);
    } catch (err) {
      console.error('Failed to fetch bank loans:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchLoans(); }, [fetchLoans]);

  const fetchLoanDetail = useCallback(async (loanId: string) => {
    try {
      setScheduleLoading(true);
      const res = await api.get<BankLoan>(`/bank-loans/${loanId}`);
      setExpandedLoan(res.data);
    } catch (err) {
      console.error('Failed to fetch loan detail:', err);
    } finally {
      setScheduleLoading(false);
    }
  }, []);

  const toggleExpand = useCallback((loanId: string) => {
    if (expandedLoanId === loanId) {
      setExpandedLoanId(null);
      setExpandedLoan(null);
    } else {
      setExpandedLoanId(loanId);
      fetchLoanDetail(loanId);
    }
  }, [expandedLoanId, fetchLoanDetail]);

  // ── Grouped + filtered loans ──

  const groupedLoans = useMemo(() => {
    const groups: Record<DisplayGroup, BankLoan[]> = { TERM_LOAN: [], CC_PLEDGE: [], VEHICLE: [], BUSINESS: [] };
    for (const l of loans) {
      const g = getDisplayGroup(l);
      if (activeTab === 'ALL' || activeTab === g) {
        groups[g].push(l);
      }
    }
    // Sort within each group: outstanding desc
    for (const g of Object.keys(groups) as DisplayGroup[]) {
      groups[g].sort((a, b) => b.outstandingAmount - a.outstandingAmount);
    }
    return groups;
  }, [loans, activeTab]);

  // ── Actions ──

  const handleCreateLoan = useCallback(async () => {
    try {
      setLoanSaving(true);
      await api.post('/bank-loans', {
        loanNo: loanForm.loanNo,
        bankName: loanForm.bankName,
        loanType: loanForm.loanType,
        repaymentFrequency: loanForm.repaymentFrequency,
        sanctionAmount: parseFloat(loanForm.sanctionAmount),
        interestRate: parseFloat(loanForm.interestRate),
        tenure: parseInt(loanForm.tenure, 10),
        sanctionDate: loanForm.sanctionDate,
        disbursementDate: loanForm.disbursementDate || null,
        securityDetails: loanForm.securityDetails || null,
        remarks: loanForm.remarks || null,
      });
      setShowNewLoan(false);
      setLoanForm(emptyLoanForm);
      fetchLoans();
    } catch (err) {
      console.error('Failed to create loan:', err);
    } finally {
      setLoanSaving(false);
    }
  }, [loanForm, fetchLoans]);

  const openPaymentModal = useCallback((loanId: string, repayment: LoanRepayment) => {
    setPaymentTarget({ loanId, repaymentId: repayment.id, installmentNo: repayment.installmentNo, amount: repayment.totalAmount });
    setPaymentForm({ ...emptyPaymentForm, paidDate: new Date().toISOString().split('T')[0] });
    setShowPayment(true);
  }, []);

  const handleRecordPayment = useCallback(async () => {
    if (!paymentTarget) return;
    try {
      setPaymentSaving(true);
      await api.post(`/bank-loans/${paymentTarget.loanId}/repayment`, {
        installmentNo: paymentTarget.installmentNo,
        paymentMode: paymentForm.paymentMode,
        paymentRef: paymentForm.paymentRef || null,
        paidDate: paymentForm.paidDate,
        remarks: paymentForm.remarks || null,
      });
      setShowPayment(false);
      setPaymentTarget(null);
      fetchLoans();
      if (expandedLoanId === paymentTarget.loanId) fetchLoanDetail(paymentTarget.loanId);
    } catch (err) {
      console.error('Failed to record payment:', err);
    } finally {
      setPaymentSaving(false);
    }
  }, [paymentTarget, paymentForm, fetchLoans, expandedLoanId, fetchLoanDetail]);

  // When a filter tab is selected, rebuild KPI numbers from the filtered loan list
  // so totals on the strip match the rows shown below.
  // NOTE: This useMemo MUST stay above the `if (loading) return` early-exit so
  // hook order never changes between renders (React error #310).
  const s = useMemo(() => {
    if (!summary) return null;
    if (activeTab === 'ALL') return summary;
    const visible = ([] as BankLoan[]).concat(
      groupedLoans.TERM_LOAN, groupedLoans.CC_PLEDGE, groupedLoans.VEHICLE, groupedLoans.BUSINESS
    );
    const active = visible.filter(l => l.status === 'ACTIVE');
    const closed = visible.filter(l => l.status === 'CLOSED');
    const totalSanc = visible.reduce((a, l) => a + l.sanctionAmount, 0);
    const totalOS = visible.reduce((a, l) => a + l.outstandingAmount, 0);
    const monthlyEq = (emi: number, freq: string) => freq === 'MONTHLY' ? emi : freq === 'QUARTERLY' ? emi / 3 : freq === 'HALF_YEARLY' ? emi / 6 : 0;
    const monthlyOut = active.reduce((a, l) => a + monthlyEq(l.emiAmount, l.repaymentFrequency), 0);
    const weightedRate = totalOS > 0 ? visible.reduce((a, l) => a + l.interestRate * l.outstandingAmount, 0) / totalOS : 0;
    const unsec = visible.filter(l => (l.securityDetails || '').toUpperCase().includes('UNSECURED')).reduce((a, l) => a + l.outstandingAmount, 0);
    const sec = totalOS - unsec;
    return {
      ...summary,
      totalSanctioned: totalSanc,
      totalOutstanding: totalOS,
      utilizationPercent: totalSanc > 0 ? Math.round((totalOS / totalSanc) * 100) : 0,
      monthlyOutflow: Math.round(monthlyOut),
      weightedAvgRate: weightedRate,
      activeCount: active.length,
      closedCount: closed.length,
      totalCount: visible.length,
      securedOutstanding: sec,
      unsecuredOutstanding: unsec,
      // nextPayment stays from server (cross-filter next payment still useful context)
    };
  }, [summary, activeTab, groupedLoans]);

  // ── Loading ──

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  const pieData = s?.byType.map((t) => ({ name: t.label, value: t.outstanding, type: t.loanType })) || [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* ═══ Toolbar ═══ */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Bank Loans</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Debt Management & Repayment Tracking</span>
          </div>
          <button
            onClick={() => { setLoanForm(emptyLoanForm); setShowNewLoan(true); }}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
          >
            + New Loan
          </button>
        </div>

        {/* ═══ KPI Strip — 6 cards ═══ */}
        {s && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            {/* 1. Total Outstanding */}
            <div className="bg-white px-4 py-3 border-r border-b lg:border-b-0 border-slate-300 border-l-4 border-l-red-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Outstanding</div>
              <div className="text-lg font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtINR(s.totalOutstanding)}</div>
              <div className="mt-1.5 h-[3px] bg-red-100 w-full">
                <div className="h-full bg-red-500" style={{ width: `${Math.min(s.utilizationPercent, 100)}%` }} />
              </div>
              <div className="text-[9px] text-slate-400 mt-0.5">{s.utilizationPercent}% of {fmtINR(s.totalSanctioned)} sanctioned</div>
            </div>

            {/* 2. Monthly Outflow */}
            <div className="bg-white px-4 py-3 border-r border-b lg:border-b-0 border-slate-300 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Monthly Outflow</div>
              <div className="text-lg font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtINR(s.monthlyOutflow)}</div>
              <div className="text-[9px] text-slate-400 mt-0.5">EMI + Quarterly/3 normalized</div>
            </div>

            {/* 3. Weighted Avg Rate */}
            <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Avg Interest Rate</div>
              <div className={`text-lg font-bold mt-1 font-mono tabular-nums ${rateColor(s.weightedAvgRate)}`}>{s.weightedAvgRate.toFixed(2)}%</div>
              <div className="text-[9px] text-slate-400 mt-0.5">Weighted by outstanding</div>
            </div>

            {/* 4. Active / Total */}
            <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-green-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Loans</div>
              <div className="text-lg font-bold text-slate-800 mt-1 font-mono tabular-nums">{s.activeCount}<span className="text-sm text-slate-400 font-normal"> / {s.totalCount}</span></div>
              {s.closedCount > 0 && <div className="text-[9px] text-slate-400 mt-0.5">{s.closedCount} closed</div>}
            </div>

            {/* 5. Secured vs Unsecured */}
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-purple-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Secured / Unsecured</div>
              <div className="text-sm font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtINR(s.securedOutstanding)}</div>
              <div className="text-[9px] text-red-500 font-mono">{fmtINR(s.unsecuredOutstanding)} unsecured</div>
            </div>

            {/* 6. Next Payment */}
            <div className="bg-white px-4 py-3 border-l-4 border-l-cyan-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Next Payment</div>
              {s.nextPayment ? (
                <>
                  <div className="text-lg font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtINR(s.nextPayment.amount)}</div>
                  <div className="text-[9px] text-slate-400">{s.nextPayment.bankName} -- {fmtDate(s.nextPayment.dueDate)}</div>
                </>
              ) : (
                <>
                  <div className="text-sm text-slate-400 mt-1">No scheduled payments</div>
                  <div className="text-[9px] text-slate-400">Loans imported without schedule</div>
                </>
              )}
            </div>
          </div>
        )}

        {/* ═══ Filter Tabs + Charts Row ═══ */}
        <div className="flex flex-col lg:flex-row gap-0 -mx-3 md:-mx-6 border-x border-b border-slate-300">
          {/* Left: Filter tabs + upcoming outflows */}
          <div className="flex-1 border-r border-slate-300">
            {/* Tab bar */}
            <div className="bg-slate-100 border-b border-slate-300 px-4 py-2 flex items-center gap-1">
              {FILTER_TABS.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`px-3 py-1 text-[11px] font-bold uppercase tracking-widest transition-colors ${
                    activeTab === tab.key
                      ? 'border-b-2 border-blue-600 text-blue-700 bg-white'
                      : 'text-slate-500 hover:text-slate-700 hover:bg-white/50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Upcoming 12-month cash-flow chart — stacked by loan type */}
            {s && s.upcomingOutflows.length > 0 && (
              <div className="px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">EMI Cash-Flow — Next 12 Months</div>
                    <div className="text-[9px] text-slate-400">Stacked by loan type · from actual repayment schedule</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">12-Month Total</div>
                    <div className="text-sm font-bold text-slate-800 font-mono">{fmtINR(s.upcomingOutflows.reduce((a, m) => a + m.totalOutflow, 0))}</div>
                  </div>
                </div>
                <div className="h-[200px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={s.upcomingOutflows} barSize={28}>
                      <XAxis dataKey="month" tick={{ fontSize: 10, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v: number) => fmtINR(v)} width={70} />
                      <Tooltip content={<StackedTooltip />} />
                      <Bar dataKey="TERM_LOAN" stackId="a" fill="#334155" />
                      <Bar dataKey="WORKING_CAPITAL" stackId="a" fill="#f59e0b" />
                      <Bar dataKey="EQUIPMENT" stackId="a" fill="#3b82f6" />
                      <Bar dataKey="CC_LIMIT" stackId="a" fill="#6366f1" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                  {[
                    { k: 'TERM_LOAN', label: 'Term Loan', color: '#334155' },
                    { k: 'WORKING_CAPITAL', label: 'Working Capital', color: '#f59e0b' },
                    { k: 'EQUIPMENT', label: 'Vehicle / Equipment', color: '#3b82f6' },
                    { k: 'CC_LIMIT', label: 'CC Limit', color: '#6366f1' },
                  ].map(d => (
                    <div key={d.k} className="flex items-center gap-1.5 text-[10px] text-slate-600">
                      <span className="w-3 h-3 inline-block" style={{ background: d.color }} />
                      <span>{d.label}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Right: Pie chart — debt composition */}
          {s && pieData.length > 0 && (
            <div className="w-full lg:w-[280px] px-4 py-3 flex flex-col items-center">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Debt Composition</div>
              <div className="h-[140px] w-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      outerRadius={55}
                      innerRadius={25}
                      dataKey="value"
                      paddingAngle={1}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.type} fill={TYPE_COLORS[entry.type] || '#94a3b8'} />
                      ))}
                    </Pie>
                    <Tooltip content={<ChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              {/* Legend */}
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                {pieData.map((d) => (
                  <div key={d.type} className="flex items-center gap-1">
                    <div className="w-2 h-2" style={{ backgroundColor: TYPE_COLORS[d.type] || '#94a3b8' }} />
                    <span className="text-[9px] text-slate-500">{d.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* ═══ Grouped Loan Table ═══ */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs min-w-[1000px]">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-[180px]">Bank</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-[160px]">Loan No</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-[100px]">Sanctioned</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-[100px]">Outstanding</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-[60px]">Rate</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-[120px]">Payment</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-[90px]">Next Due</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-[130px]">Security</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-[70px]">Remaining</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-[70px]">Status</th>
              </tr>
            </thead>
            <tbody>
              {DISPLAY_GROUPS.map((group) => {
                const groupLoans = groupedLoans[group.key];
                if (groupLoans.length === 0) return null;
                const groupOutstanding = groupLoans.reduce((s, l) => s + l.outstandingAmount, 0);
                const groupSanctioned = groupLoans.reduce((s, l) => s + l.sanctionAmount, 0);
                return (
                  <React.Fragment key={group.key}>
                    {/* Group header */}
                    <tr className={`bg-slate-200 border-b border-slate-300 border-l-4 ${group.color}`}>
                      <td colSpan={3} className="px-3 py-2">
                        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">{group.label}</span>
                        <span className="text-[10px] text-slate-400 ml-2">({groupLoans.length})</span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-[10px] font-bold text-slate-700 font-mono">{fmtINR(groupOutstanding)}</span>
                      </td>
                      <td colSpan={2} className="px-3 py-2 text-right">
                        <span className="text-[10px] text-slate-400 font-mono">of {fmtINR(groupSanctioned)}</span>
                      </td>
                      <td colSpan={4} />
                    </tr>
                    {/* Loan rows */}
                    {groupLoans.map((loan, i) => {
                      const isExpanded = expandedLoanId === loan.id;
                      const isClosed = loan.status === 'CLOSED';
                      const rem = remainingMonths(loan.maturityDate);
                      const fb = freqBadge(loan.repaymentFrequency);
                      return (
                        <React.Fragment key={loan.id}>
                          <tr
                            className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''} ${isExpanded ? 'bg-blue-50/60' : ''} ${isClosed ? 'opacity-50' : ''}`}
                            onClick={() => toggleExpand(loan.id)}
                          >
                            <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">
                              <span className="mr-1.5 text-slate-400 text-[10px]">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                              {loan.bankName}
                            </td>
                            <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 font-mono text-[10px]" title={loan.loanNo}>
                              {loan.loanNo.length > 22 ? loan.loanNo.slice(0, 22) + '...' : loan.loanNo}
                            </td>
                            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100">{fmtINR(loan.sanctionAmount)}</td>
                            <td className={`px-3 py-1.5 text-right font-mono tabular-nums font-medium border-r border-slate-100 ${isClosed ? 'line-through text-slate-400' : 'text-slate-800'}`}>
                              {fmtINR(loan.outstandingAmount)}
                            </td>
                            <td className={`px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 ${rateColor(loan.interestRate)}`}>
                              {loan.interestRate.toFixed(1)}%
                            </td>
                            <td className="px-3 py-1.5 text-right border-r border-slate-100">
                              <span className="font-mono tabular-nums text-slate-700">{loan.emiAmount > 0 ? fmtINR(loan.emiAmount) : '--'}</span>
                              <span className={`ml-1.5 inline-block text-[8px] font-bold uppercase px-1 py-0 border ${fb.cls}`}>{fb.label}</span>
                            </td>
                            <td className="px-3 py-1.5 text-center border-r border-slate-100">
                              {loan.repaymentSummary?.nextDueDate ? (
                                <span className={`font-mono text-[10px] ${new Date(loan.repaymentSummary.nextDueDate) < new Date() ? 'text-red-600 font-bold' : 'text-slate-600'}`}>
                                  {new Date(loan.repaymentSummary.nextDueDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                </span>
                              ) : <span className="text-slate-300">--</span>}
                            </td>
                            <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100 truncate max-w-[130px]" title={loan.securityDetails || ''}>
                              {loan.securityDetails ? loan.securityDetails.slice(0, 20) + (loan.securityDetails.length > 20 ? '...' : '') : '--'}
                            </td>
                            <td className="px-3 py-1.5 text-center text-slate-600 font-mono border-r border-slate-100">{fmtTenure(rem)}</td>
                            <td className="px-3 py-1.5 text-center">
                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusBadge(loan.status)}`}>{loan.status}</span>
                            </td>
                          </tr>

                          {/* Expanded detail */}
                          {isExpanded && (
                            <tr>
                              <td colSpan={10} className="p-0">
                                <div className="bg-slate-50 border-b border-slate-300">
                                  {/* Loan detail bar */}
                                  <div className="bg-slate-200 border-b border-slate-300 px-4 py-2 flex flex-wrap items-center gap-4 text-[10px] text-slate-600">
                                    <span><b>Type:</b> {loanTypeLabel(loan.loanType)}</span>
                                    <span><b>Freq:</b> {FREQ_OPTIONS.find(f => f.value === loan.repaymentFrequency)?.label || loan.repaymentFrequency}</span>
                                    <span><b>Disbursed:</b> {fmtDate(loan.disbursementDate)}</span>
                                    <span><b>Maturity:</b> {fmtDate(loan.maturityDate)}</span>
                                    <span><b>Tenure:</b> {loan.tenure} months</span>
                                    {loan.securityDetails && <span><b>Security:</b> {loan.securityDetails}</span>}
                                    {loan.remarks && <span className="text-slate-400"><b>Note:</b> {loan.remarks}</span>}
                                  </div>

                                  {scheduleLoading ? (
                                    <div className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">Loading schedule...</div>
                                  ) : expandedLoan && expandedLoan.repayments && expandedLoan.repayments.length > 0 ? (
                                    <table className="w-full text-xs">
                                      <thead>
                                        <tr className="bg-slate-700 text-white">
                                          <th className="text-center px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">#</th>
                                          <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Due Date</th>
                                          <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Principal</th>
                                          <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Interest</th>
                                          <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Total</th>
                                          <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">O/S After</th>
                                          <th className="text-center px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Status</th>
                                          <th className="text-center px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Action</th>
                                        </tr>
                                      </thead>
                                      <tbody>
                                        {expandedLoan.repayments.map((r, ri) => (
                                          <tr key={r.id} className={`border-b border-slate-100 ${r.status === 'OVERDUE' ? 'bg-red-50/70' : ri % 2 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                            <td className="px-3 py-1.5 text-center text-slate-500 border-r border-slate-100">{r.installmentNo}</td>
                                            <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{fmtDate(r.dueDate)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtINR(r.principalAmount)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtINR(r.interestAmount)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium border-r border-slate-100">{fmtINR(r.totalAmount)}</td>
                                            <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100">{fmtINR(r.outstandingAfter)}</td>
                                            <td className="px-3 py-1.5 text-center border-r border-slate-100">
                                              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusBadge(r.status)}`}>{r.status}</span>
                                            </td>
                                            <td className="px-3 py-1.5 text-center">
                                              {(r.status === 'SCHEDULED' || r.status === 'OVERDUE') && (
                                                <button
                                                  onClick={(e) => { e.stopPropagation(); openPaymentModal(loan.id, r); }}
                                                  className="px-2 py-0.5 bg-green-600 text-white text-[10px] font-medium hover:bg-green-700"
                                                >
                                                  Mark Paid
                                                </button>
                                              )}
                                            </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  ) : (
                                    <div className="px-4 py-6 text-center text-[10px] text-slate-400 uppercase tracking-widest">
                                      No repayment schedule generated -- Bulk imported loan
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </React.Fragment>
                );
              })}
              {loans.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No loans found</td>
                </tr>
              )}
            </tbody>

            {/* Table footer — Grand totals */}
            {loans.length > 0 && (
              <tfoot>
                <tr className="bg-slate-800 text-white font-semibold">
                  <td colSpan={2} className="px-3 py-2 text-[10px] uppercase tracking-widest border-r border-slate-700">Grand Total ({loans.length} loans)</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[11px] border-r border-slate-700">{fmtINR(loans.reduce((s, l) => s + l.sanctionAmount, 0))}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-[11px] border-r border-slate-700">{fmtINR(loans.reduce((s, l) => s + l.outstandingAmount, 0))}</td>
                  <td colSpan={6} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* ═══ New Loan Modal ═══ */}
        {showNewLoan && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest">New Bank Loan</span>
                <button onClick={() => setShowNewLoan(false)} className="text-slate-400 hover:text-white text-sm">X</button>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Loan No *</label>
                    <input type="text" value={loanForm.loanNo} onChange={(e) => setLoanForm({ ...loanForm, loanNo: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g. TL-2026-001" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Bank Name *</label>
                    <input type="text" value={loanForm.bankName} onChange={(e) => setLoanForm({ ...loanForm, bankName: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g. Union Bank of India" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Loan Type *</label>
                    <select value={loanForm.loanType} onChange={(e) => setLoanForm({ ...loanForm, loanType: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white">
                      {LOAN_TYPES.map((lt) => <option key={lt.value} value={lt.value}>{lt.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Repayment Frequency *</label>
                    <select value={loanForm.repaymentFrequency} onChange={(e) => setLoanForm({ ...loanForm, repaymentFrequency: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white">
                      {FREQ_OPTIONS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Sanction Amount *</label>
                    <input type="number" value={loanForm.sanctionAmount} onChange={(e) => setLoanForm({ ...loanForm, sanctionAmount: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="0.00" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Interest Rate (% p.a.) *</label>
                    <input type="number" step="0.01" value={loanForm.interestRate} onChange={(e) => setLoanForm({ ...loanForm, interestRate: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g. 9.50" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Tenure (months) *</label>
                    <input type="number" value={loanForm.tenure} onChange={(e) => setLoanForm({ ...loanForm, tenure: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g. 60" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Sanction Date *</label>
                    <input type="date" value={loanForm.sanctionDate} onChange={(e) => setLoanForm({ ...loanForm, sanctionDate: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Disbursement Date</label>
                  <input type="date" value={loanForm.disbursementDate} onChange={(e) => setLoanForm({ ...loanForm, disbursementDate: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Security Details</label>
                  <input type="text" value={loanForm.securityDetails} onChange={(e) => setLoanForm({ ...loanForm, securityDetails: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g. Plant & machinery hypothecation" />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                  <textarea value={loanForm.remarks} onChange={(e) => setLoanForm({ ...loanForm, remarks: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none" rows={2} placeholder="Optional notes" />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                  <button onClick={() => setShowNewLoan(false)}
                    className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                  <button onClick={handleCreateLoan}
                    disabled={loanSaving || !loanForm.loanNo || !loanForm.bankName || !loanForm.sanctionAmount || !loanForm.interestRate || !loanForm.tenure || !loanForm.sanctionDate}
                    className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    {loanSaving ? 'Creating...' : 'Create Loan'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ═══ Record Payment Modal ═══ */}
        {showPayment && paymentTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white shadow-2xl w-full max-w-md">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest">Record Payment -- Installment #{paymentTarget.installmentNo}</span>
                <button onClick={() => setShowPayment(false)} className="text-slate-400 hover:text-white text-sm">X</button>
              </div>
              <div className="p-4 space-y-3">
                <div className="bg-slate-100 border border-slate-300 px-3 py-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">EMI Amount</div>
                  <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{fmtINR(paymentTarget.amount)}</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Mode *</label>
                    <select value={paymentForm.paymentMode} onChange={(e) => setPaymentForm({ ...paymentForm, paymentMode: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white">
                      {PAYMENT_MODES.map((pm) => <option key={pm.value} value={pm.value}>{pm.label}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Paid Date *</label>
                    <input type="date" value={paymentForm.paidDate} onChange={(e) => setPaymentForm({ ...paymentForm, paidDate: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Reference</label>
                  <input type="text" value={paymentForm.paymentRef} onChange={(e) => setPaymentForm({ ...paymentForm, paymentRef: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g. UTR / Cheque No." />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                  <input type="text" value={paymentForm.remarks} onChange={(e) => setPaymentForm({ ...paymentForm, remarks: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Optional" />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                  <button onClick={() => setShowPayment(false)}
                    className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                  <button onClick={handleRecordPayment}
                    disabled={paymentSaving || !paymentForm.paidDate}
                    className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed">
                    {paymentSaving ? 'Saving...' : 'Confirm Payment'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
