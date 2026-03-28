import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

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
  createdAt: string;
}

interface LoanSummary {
  totalOutstanding: number;
  monthlyEmiBurden: number;
  nextDueDate: string | null;
  nextDueAmount: number;
  activeCount: number;
}

const LOAN_TYPES = [
  { value: 'TERM_LOAN', label: 'Term Loan' },
  { value: 'WORKING_CAPITAL', label: 'Working Capital' },
  { value: 'CC_LIMIT', label: 'CC Limit' },
  { value: 'EQUIPMENT', label: 'Equipment Loan' },
];

const PAYMENT_MODES = [
  { value: 'NEFT', label: 'NEFT' },
  { value: 'RTGS', label: 'RTGS' },
  { value: 'CHEQUE', label: 'Cheque' },
  { value: 'AUTO_DEBIT', label: 'Auto Debit' },
  { value: 'UPI', label: 'UPI' },
];

const fmtCurrency = (n: number): string =>
  n === 0 ? '--' : '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });

const fmtDate = (d: string | null): string => {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const loanTypeLabel = (t: string): string =>
  LOAN_TYPES.find((lt) => lt.value === t)?.label || t;

const statusColor = (s: string): string => {
  switch (s) {
    case 'ACTIVE': return 'border-green-500 bg-green-50 text-green-700';
    case 'CLOSED': return 'border-slate-400 bg-slate-50 text-slate-600';
    case 'OVERDUE': return 'border-red-500 bg-red-50 text-red-700';
    case 'PAID': return 'border-green-500 bg-green-50 text-green-700';
    case 'SCHEDULED': return 'border-blue-400 bg-blue-50 text-blue-600';
    case 'DEFAULTED': return 'border-red-600 bg-red-50 text-red-700';
    default: return 'border-slate-300 bg-slate-50 text-slate-600';
  }
};

const repaymentStatusColor = (s: string): string => {
  switch (s) {
    case 'PAID': return 'border-green-500 bg-green-50 text-green-700';
    case 'SCHEDULED': return 'border-blue-400 bg-blue-50 text-blue-600';
    case 'OVERDUE': return 'border-red-500 bg-red-50 text-red-700';
    default: return 'border-slate-300 bg-slate-50 text-slate-600';
  }
};

interface NewLoanForm {
  loanNo: string;
  bankName: string;
  loanType: string;
  sanctionAmount: string;
  interestRate: string;
  tenure: string;
  sanctionDate: string;
  disbursementDate: string;
  securityDetails: string;
  remarks: string;
}

const emptyLoanForm: NewLoanForm = {
  loanNo: '',
  bankName: '',
  loanType: 'TERM_LOAN',
  sanctionAmount: '',
  interestRate: '',
  tenure: '',
  sanctionDate: '',
  disbursementDate: '',
  securityDetails: '',
  remarks: '',
};

interface PaymentForm {
  paymentMode: string;
  paymentRef: string;
  paidDate: string;
  remarks: string;
}

const emptyPaymentForm: PaymentForm = {
  paymentMode: 'NEFT',
  paymentRef: '',
  paidDate: new Date().toISOString().split('T')[0],
  remarks: '',
};

export default function BankLoans() {
  const [loans, setLoans] = useState<BankLoan[]>([]);
  const [summary, setSummary] = useState<LoanSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedLoanId, setExpandedLoanId] = useState<string | null>(null);
  const [expandedLoan, setExpandedLoan] = useState<BankLoan | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);

  // New Loan modal
  const [showNewLoan, setShowNewLoan] = useState(false);
  const [loanForm, setLoanForm] = useState<NewLoanForm>(emptyLoanForm);
  const [loanSaving, setLoanSaving] = useState(false);

  // Payment modal
  const [showPayment, setShowPayment] = useState(false);
  const [paymentForm, setPaymentForm] = useState<PaymentForm>(emptyPaymentForm);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentTarget, setPaymentTarget] = useState<{ loanId: string; repaymentId: string; installmentNo: number; amount: number } | null>(null);

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

  const handleCreateLoan = useCallback(async () => {
    try {
      setLoanSaving(true);
      await api.post('/bank-loans', {
        loanNo: loanForm.loanNo,
        bankName: loanForm.bankName,
        loanType: loanForm.loanType,
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
        repaymentId: paymentTarget.repaymentId,
        paymentMode: paymentForm.paymentMode,
        paymentRef: paymentForm.paymentRef || null,
        paidDate: paymentForm.paidDate,
        remarks: paymentForm.remarks || null,
      });
      setShowPayment(false);
      setPaymentTarget(null);
      fetchLoans();
      if (expandedLoanId === paymentTarget.loanId) {
        fetchLoanDetail(paymentTarget.loanId);
      }
    } catch (err) {
      console.error('Failed to record payment:', err);
    } finally {
      setPaymentSaving(false);
    }
  }, [paymentTarget, paymentForm, fetchLoans, expandedLoanId, fetchLoanDetail]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Bank Loans</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Loan Management & EMI Tracking</span>
          </div>
          <button
            onClick={() => { setLoanForm(emptyLoanForm); setShowNewLoan(true); }}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
          >
            + New Loan
          </button>
        </div>

        {/* KPI Strip */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-red-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Outstanding</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(summary.totalOutstanding)}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Monthly EMI Burden</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(summary.monthlyEmiBurden)}</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Next Due</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">
                {summary.nextDueDate ? fmtCurrency(summary.nextDueAmount) : '--'}
              </div>
              {summary.nextDueDate && (
                <div className="text-[10px] text-slate-400 mt-0.5">{fmtDate(summary.nextDueDate)}</div>
              )}
            </div>
            <div className="bg-white px-4 py-3 border-l-4 border-l-green-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Loans</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.activeCount}</div>
            </div>
          </div>
        )}

        {/* Loans Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Loan No</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Bank</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Sanctioned</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Disbursed</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Outstanding</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate%</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">EMI</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Tenure</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Progress</th>
              </tr>
            </thead>
            <tbody>
              {loans.length === 0 && (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">
                    No loans found
                  </td>
                </tr>
              )}
              {loans.map((loan, i) => {
                const paid = loan.repayments?.filter((r) => r.status === 'PAID').length || 0;
                const total = loan.repayments?.length || 0;
                const isExpanded = expandedLoanId === loan.id;
                return (
                  <React.Fragment key={loan.id}>
                    <tr
                      className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''} ${isExpanded ? 'bg-blue-50/60' : ''}`}
                      onClick={() => toggleExpand(loan.id)}
                    >
                      <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">
                        <span className="mr-1.5 text-slate-400 text-[10px]">{isExpanded ? '\u25BC' : '\u25B6'}</span>
                        {loan.loanNo}
                      </td>
                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{loan.bankName}</td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{loanTypeLabel(loan.loanType)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(loan.sanctionAmount)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(loan.disbursedAmount)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium border-r border-slate-100">{fmtCurrency(loan.outstandingAmount)}</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{loan.interestRate.toFixed(2)}%</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(loan.emiAmount)}</td>
                      <td className="px-3 py-1.5 text-center text-slate-600 border-r border-slate-100">{loan.tenure} mo</td>
                      <td className="px-3 py-1.5 text-center border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColor(loan.status)}`}>{loan.status}</span>
                      </td>
                      <td className="px-3 py-1.5 text-center">
                        <span className="font-mono tabular-nums text-slate-600">{paid}/{total}</span>
                      </td>
                    </tr>
                    {/* Expanded repayment schedule */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={11} className="p-0">
                          <div className="bg-slate-50 border-b border-slate-300">
                            {/* Loan detail header */}
                            <div className="bg-slate-200 border-b border-slate-300 px-4 py-2 flex items-center justify-between">
                              <div className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
                                Repayment Schedule - {loan.loanNo}
                              </div>
                              <div className="flex items-center gap-4 text-[10px] text-slate-500">
                                {loan.sanctionDate && <span>Sanction: {fmtDate(loan.sanctionDate)}</span>}
                                {loan.disbursementDate && <span>Disbursed: {fmtDate(loan.disbursementDate)}</span>}
                                {loan.maturityDate && <span>Maturity: {fmtDate(loan.maturityDate)}</span>}
                                {loan.securityDetails && <span>Security: {loan.securityDetails}</span>}
                              </div>
                            </div>
                            {scheduleLoading ? (
                              <div className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">Loading schedule...</div>
                            ) : expandedLoan ? (
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="bg-slate-700 text-white">
                                    <th className="text-center px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">#</th>
                                    <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Due Date</th>
                                    <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Principal</th>
                                    <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Interest</th>
                                    <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">EMI Total</th>
                                    <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Outstanding After</th>
                                    <th className="text-center px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Status</th>
                                    <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Paid Date</th>
                                    <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Ref</th>
                                    <th className="text-center px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {expandedLoan.repayments.map((r, ri) => (
                                    <tr
                                      key={r.id}
                                      className={`border-b border-slate-100 ${r.status === 'OVERDUE' ? 'bg-red-50/70' : ri % 2 ? 'bg-white' : 'bg-slate-50/50'}`}
                                    >
                                      <td className="px-3 py-1.5 text-center text-slate-500 border-r border-slate-100">{r.installmentNo}</td>
                                      <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{fmtDate(r.dueDate)}</td>
                                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(r.principalAmount)}</td>
                                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(r.interestAmount)}</td>
                                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium border-r border-slate-100">{fmtCurrency(r.totalAmount)}</td>
                                      <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100">{fmtCurrency(r.outstandingAfter)}</td>
                                      <td className="px-3 py-1.5 text-center border-r border-slate-100">
                                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${repaymentStatusColor(r.status)}`}>{r.status}</span>
                                      </td>
                                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{r.paidDate ? fmtDate(r.paidDate) : '--'}</td>
                                      <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{r.paymentRef || '--'}</td>
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
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* New Loan Modal */}
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
                    <input
                      type="text"
                      value={loanForm.loanNo}
                      onChange={(e) => setLoanForm({ ...loanForm, loanNo: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                      placeholder="e.g. TL-2026-001"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Bank Name *</label>
                    <input
                      type="text"
                      value={loanForm.bankName}
                      onChange={(e) => setLoanForm({ ...loanForm, bankName: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                      placeholder="e.g. State Bank of India"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Loan Type *</label>
                    <select
                      value={loanForm.loanType}
                      onChange={(e) => setLoanForm({ ...loanForm, loanType: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
                    >
                      {LOAN_TYPES.map((lt) => (
                        <option key={lt.value} value={lt.value}>{lt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Sanction Amount *</label>
                    <input
                      type="number"
                      value={loanForm.sanctionAmount}
                      onChange={(e) => setLoanForm({ ...loanForm, sanctionAmount: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Interest Rate (% p.a.) *</label>
                    <input
                      type="number"
                      step="0.01"
                      value={loanForm.interestRate}
                      onChange={(e) => setLoanForm({ ...loanForm, interestRate: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                      placeholder="e.g. 9.50"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Tenure (months) *</label>
                    <input
                      type="number"
                      value={loanForm.tenure}
                      onChange={(e) => setLoanForm({ ...loanForm, tenure: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                      placeholder="e.g. 60"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Sanction Date *</label>
                    <input
                      type="date"
                      value={loanForm.sanctionDate}
                      onChange={(e) => setLoanForm({ ...loanForm, sanctionDate: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Disbursement Date</label>
                    <input
                      type="date"
                      value={loanForm.disbursementDate}
                      onChange={(e) => setLoanForm({ ...loanForm, disbursementDate: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Security Details</label>
                  <input
                    type="text"
                    value={loanForm.securityDetails}
                    onChange={(e) => setLoanForm({ ...loanForm, securityDetails: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="e.g. Hypothecation of plant & machinery"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                  <textarea
                    value={loanForm.remarks}
                    onChange={(e) => setLoanForm({ ...loanForm, remarks: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none"
                    rows={2}
                    placeholder="Optional notes"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                  <button
                    onClick={() => setShowNewLoan(false)}
                    className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleCreateLoan}
                    disabled={loanSaving || !loanForm.loanNo || !loanForm.bankName || !loanForm.sanctionAmount || !loanForm.interestRate || !loanForm.tenure || !loanForm.sanctionDate}
                    className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loanSaving ? 'Creating...' : 'Create Loan'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Record Payment Modal */}
        {showPayment && paymentTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
            <div className="bg-white shadow-2xl w-full max-w-md">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest">Record Payment - Installment #{paymentTarget.installmentNo}</span>
                <button onClick={() => setShowPayment(false)} className="text-slate-400 hover:text-white text-sm">X</button>
              </div>
              <div className="p-4 space-y-3">
                <div className="bg-slate-100 border border-slate-300 px-3 py-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">EMI Amount</div>
                  <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{fmtCurrency(paymentTarget.amount)}</div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Mode *</label>
                    <select
                      value={paymentForm.paymentMode}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paymentMode: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
                    >
                      {PAYMENT_MODES.map((pm) => (
                        <option key={pm.value} value={pm.value}>{pm.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Paid Date *</label>
                    <input
                      type="date"
                      value={paymentForm.paidDate}
                      onChange={(e) => setPaymentForm({ ...paymentForm, paidDate: e.target.value })}
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Reference</label>
                  <input
                    type="text"
                    value={paymentForm.paymentRef}
                    onChange={(e) => setPaymentForm({ ...paymentForm, paymentRef: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="e.g. UTR / Cheque No."
                  />
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                  <input
                    type="text"
                    value={paymentForm.remarks}
                    onChange={(e) => setPaymentForm({ ...paymentForm, remarks: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                    placeholder="Optional"
                  />
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                  <button
                    onClick={() => setShowPayment(false)}
                    className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleRecordPayment}
                    disabled={paymentSaving || !paymentForm.paidDate}
                    className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
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
