import React, { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api';

// ── Types ────────────────────────────────────────────────
interface Contractor {
  id: string;
  contractorCode: string;
  name: string;
  tradeName: string | null;
  pan: string;
  panType: string;
  gstin: string | null;
  contractorType: string;
  phone: string | null;
  tdsSection: string;
  tdsPercent: number;
  isActive: boolean;
  bankAccount: string | null;
  bankIfsc: string | null;
  bankName: string | null;
  outstanding: number;
  _count: { bills: number; payments: number };
}

interface BillLine {
  id?: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
}

interface Bill {
  id: string;
  billNo: number;
  contractorId: string;
  contractor: { id: string; name: string; contractorCode: string; panType: string; contractorType: string };
  billDate: string;
  billPath: string;
  description: string;
  subtotal: number;
  cgstPercent: number; sgstPercent: number; igstPercent: number;
  cgstAmount: number; sgstAmount: number; igstAmount: number;
  totalAmount: number;
  tdsPercent: number;
  tdsAmount: number;
  netPayable: number;
  paidAmount: number;
  balanceAmount: number;
  status: string;
  vendorBillNo: string | null;
  documentUrl: string | null;
  lines: BillLine[];
  _count: { payments: number };
}

interface Payment {
  id: string;
  contractorId: string;
  contractor: { id: string; name: string; contractorCode: string };
  bill: { id: string; billNo: number; description: string } | null;
  amount: number;
  tdsDeducted: number;
  paymentMode: string;
  paymentRef: string | null;
  paymentDate: string;
  paymentStatus: string;
}

interface BillStats {
  total: number;
  draft: number;
  confirmed: number;
  outstanding: number;
  paid: number;
}

// ── Helpers ────────────────────────────────────────────────
const fmt = (n: number) => n === 0 ? '--' : '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });
const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
const TYPES = ['CIVIL', 'ELECTRICAL', 'MANPOWER', 'TRANSPORT', 'DAILY_WORK', 'OTHER'] as const;
const UNITS = ['NOS', 'DAYS', 'SQ.FT', 'CU.M', 'KG', 'MT', 'LUMP'] as const;
const PAY_MODES = ['NEFT', 'RTGS', 'UPI', 'CASH', 'CHEQUE', 'BANK_TRANSFER'] as const;

function detectPanType(pan: string): { panType: string; tdsPercent: number } {
  if (pan.length < 4) return { panType: '', tdsPercent: 0 };
  const fourthChar = pan.charAt(3).toUpperCase();
  const panType = fourthChar === 'P' ? 'INDIVIDUAL' : 'COMPANY';
  return { panType, tdsPercent: panType === 'INDIVIDUAL' ? 1 : 2 };
}

// ── Status Badge ────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    DRAFT: 'border-slate-300 bg-slate-50 text-slate-600',
    CONFIRMED: 'border-blue-300 bg-blue-50 text-blue-700',
    PARTIAL_PAID: 'border-amber-300 bg-amber-50 text-amber-700',
    PAID: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    CANCELLED: 'border-red-300 bg-red-50 text-red-600',
    INITIATED: 'border-amber-300 bg-amber-50 text-amber-700',
  };
  return <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${colors[status] || colors.DRAFT}`}>{status.replace('_', ' ')}</span>;
}

// ══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════
export default function ContractorManagement() {
  const [tab, setTab] = useState<'contractors' | 'bills' | 'payments'>('contractors');
  const [contractors, setContractors] = useState<Contractor[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [billStats, setBillStats] = useState<BillStats>({ total: 0, draft: 0, confirmed: 0, outstanding: 0, paid: 0 });
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);

  // Contractor form
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [cForm, setCForm] = useState({ name: '', tradeName: '', pan: '', gstin: '', gstState: '', aadhaarNo: '', contractorType: 'OTHER', phone: '', email: '', address: '', bankName: '', bankBranch: '', bankAccount: '', bankIfsc: '', remarks: '' });

  // Bill form
  const [showBillForm, setShowBillForm] = useState(false);
  const [billPath, setBillPath] = useState<'CREATED' | 'UPLOADED'>('CREATED');
  const [billForm, setBillForm] = useState({ contractorId: '', description: '', billDate: new Date().toISOString().slice(0, 10), vendorBillNo: '', subtotal: 0, cgstPercent: 0, sgstPercent: 0, igstPercent: 0 });
  const [billLines, setBillLines] = useState<BillLine[]>([{ description: '', quantity: 1, unit: 'NOS', rate: 0, amount: 0 }]);

  // Pay modal
  const [showPayModal, setShowPayModal] = useState(false);
  const [payBill, setPayBill] = useState<Bill | null>(null);
  const [payForm, setPayForm] = useState({ amount: 0, tdsDeducted: 0, paymentMode: 'NEFT', paymentRef: '', paymentDate: new Date().toISOString().slice(0, 10), remarks: '' });

  // Print modal
  const [showPrint, setShowPrint] = useState(false);
  const [printData, setPrintData] = useState<{ bill: Bill; company: { name: string; address: string; gstin: string } } | null>(null);

  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadBillId, setUploadBillId] = useState<string | null>(null);

  // ── Fetchers ────────────────────────────────────────────
  const fetchContractors = useCallback(async () => {
    try {
      const res = await api.get('/contractors');
      setContractors(res.data.contractors);
    } catch (err) { console.error('Failed to fetch contractors:', err); }
  }, []);

  const fetchBills = useCallback(async () => {
    try {
      const res = await api.get('/contractor-bills');
      setBills(res.data.bills);
      setBillStats(res.data.stats);
    } catch (err) { console.error('Failed to fetch bills:', err); }
  }, []);

  const fetchPayments = useCallback(async () => {
    try {
      const res = await api.get('/contractor-bills/payments/all');
      setPayments(res.data.payments);
    } catch (err) { console.error('Failed to fetch payments:', err); }
  }, []);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchContractors(), fetchBills(), fetchPayments()]).finally(() => setLoading(false));
  }, [fetchContractors, fetchBills, fetchPayments]);

  // ── Contractor CRUD ────────────────────────────────────
  const resetCForm = () => {
    setCForm({ name: '', tradeName: '', pan: '', gstin: '', gstState: '', aadhaarNo: '', contractorType: 'OTHER', phone: '', email: '', address: '', bankName: '', bankBranch: '', bankAccount: '', bankIfsc: '', remarks: '' });
    setEditId(null);
  };

  const openEdit = (c: Contractor) => {
    setEditId(c.id);
    setCForm({ name: c.name, tradeName: c.tradeName || '', pan: c.pan, gstin: c.gstin || '', gstState: '', aadhaarNo: '', contractorType: c.contractorType, phone: c.phone || '', email: '', address: '', bankName: c.bankName || '', bankBranch: '', bankAccount: c.bankAccount || '', bankIfsc: c.bankIfsc || '', remarks: '' });
    setShowForm(true);
  };

  const saveContractor = async () => {
    try {
      const data: Record<string, unknown> = { ...cForm };
      // Clean empty strings to null
      for (const k of ['tradeName', 'gstin', 'gstState', 'aadhaarNo', 'phone', 'email', 'address', 'bankName', 'bankBranch', 'bankAccount', 'bankIfsc', 'remarks']) {
        if (!data[k]) data[k] = null;
      }
      if (editId) {
        await api.put(`/contractors/${editId}`, data);
      } else {
        await api.post('/contractors', data);
      }
      setShowForm(false);
      resetCForm();
      fetchContractors();
    } catch (err) { console.error('Save failed:', err); }
  };

  // ── Bill CRUD ────────────────────────────────────────────
  const resetBillForm = () => {
    setBillForm({ contractorId: '', description: '', billDate: new Date().toISOString().slice(0, 10), vendorBillNo: '', subtotal: 0, cgstPercent: 0, sgstPercent: 0, igstPercent: 0 });
    setBillLines([{ description: '', quantity: 1, unit: 'NOS', rate: 0, amount: 0 }]);
    setBillPath('CREATED');
  };

  const addLine = () => setBillLines([...billLines, { description: '', quantity: 1, unit: 'NOS', rate: 0, amount: 0 }]);
  const removeLine = (i: number) => setBillLines(billLines.filter((_, idx) => idx !== i));
  const updateLine = (i: number, field: string, value: string | number) => {
    const lines = [...billLines];
    (lines[i] as Record<string, unknown>)[field] = value;
    lines[i].amount = Math.round(lines[i].quantity * lines[i].rate * 100) / 100;
    setBillLines(lines);
  };

  const billSubtotal = billPath === 'CREATED'
    ? billLines.reduce((s, l) => s + l.amount, 0)
    : billForm.subtotal;
  const billCgst = Math.round(billSubtotal * (billForm.cgstPercent / 100) * 100) / 100;
  const billSgst = Math.round(billSubtotal * (billForm.sgstPercent / 100) * 100) / 100;
  const billIgst = Math.round(billSubtotal * (billForm.igstPercent / 100) * 100) / 100;
  const billTotal = Math.round((billSubtotal + billCgst + billSgst + billIgst) * 100) / 100;
  const selectedContractor = contractors.find(c => c.id === billForm.contractorId);
  const billTdsPercent = selectedContractor?.tdsPercent || 0;
  const billTds = Math.round(billSubtotal * (billTdsPercent / 100) * 100) / 100;
  const billNet = Math.round((billTotal - billTds) * 100) / 100;

  const saveBill = async () => {
    try {
      const payload: Record<string, unknown> = {
        contractorId: billForm.contractorId,
        billPath,
        description: billForm.description,
        billDate: billForm.billDate,
        cgstPercent: billForm.cgstPercent,
        sgstPercent: billForm.sgstPercent,
        igstPercent: billForm.igstPercent,
      };
      if (billPath === 'CREATED') {
        payload.lines = billLines.filter(l => l.description && l.rate > 0);
      } else {
        payload.subtotal = billForm.subtotal;
        payload.vendorBillNo = billForm.vendorBillNo || null;
      }
      await api.post('/contractor-bills', payload);
      setShowBillForm(false);
      resetBillForm();
      fetchBills();
    } catch (err) { console.error('Save bill failed:', err); }
  };

  const confirmBill = async (id: string) => {
    try {
      await api.post(`/contractor-bills/${id}/confirm`);
      fetchBills();
    } catch (err) { console.error('Confirm failed:', err); }
  };

  const cancelBill = async (id: string) => {
    if (!confirm('Cancel this bill?')) return;
    try {
      await api.post(`/contractor-bills/${id}/cancel`);
      fetchBills();
    } catch (err) { console.error('Cancel failed:', err); }
  };

  const openPrint = async (id: string) => {
    try {
      const res = await api.get(`/contractor-bills/${id}/print`);
      setPrintData(res.data);
      setShowPrint(true);
    } catch (err) { console.error('Print failed:', err); }
  };

  const openPay = (bill: Bill) => {
    setPayBill(bill);
    setPayForm({ amount: bill.balanceAmount, tdsDeducted: 0, paymentMode: 'NEFT', paymentRef: '', paymentDate: new Date().toISOString().slice(0, 10), remarks: '' });
    setShowPayModal(true);
  };

  const submitPay = async () => {
    if (!payBill) return;
    try {
      await api.post(`/contractor-bills/${payBill.id}/pay`, payForm);
      setShowPayModal(false);
      setPayBill(null);
      fetchBills();
      fetchPayments();
      fetchContractors();
    } catch (err) { console.error('Payment failed:', err); }
  };

  const uploadDoc = async (billId: string, file: File) => {
    const fd = new FormData();
    fd.append('document', file);
    try {
      await api.post(`/contractor-bills/${billId}/upload`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      fetchBills();
    } catch (err) { console.error('Upload failed:', err); }
  };

  // ── PAN type display ─────────────────────────────────────
  const panInfo = detectPanType(cForm.pan);

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  // ── Contractor stats ───────────────────────────────────
  const totalActive = contractors.filter(c => c.isActive).length;
  const individualCount = contractors.filter(c => c.panType === 'INDIVIDUAL').length;
  const companyCount = contractors.filter(c => c.panType === 'COMPANY').length;
  const totalOutstanding = contractors.reduce((s, c) => s + c.outstanding, 0);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Contractor Management</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Manage contractors, bills, and payments</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-6 border-b border-slate-300 -mx-3 md:-mx-6 px-4 bg-white">
          {(['contractors', 'bills', 'payments'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`py-2 text-[11px] font-bold uppercase tracking-widest ${tab === t ? 'border-b-2 border-blue-600 text-blue-700' : 'text-slate-400 hover:text-slate-600'}`}>
              {t}
            </button>
          ))}
        </div>

        {/* ══════════ TAB 1: CONTRACTORS ══════════ */}
        {tab === 'contractors' && (
          <>
            {/* KPI Strip */}
            <div className="grid grid-cols-4 border-x border-b border-slate-300 -mx-3 md:-mx-6">
              {[
                { label: 'Active', value: totalActive, color: 'blue' },
                { label: 'Individual (1% TDS)', value: individualCount, color: 'emerald' },
                { label: 'Company (2% TDS)', value: companyCount, color: 'violet' },
                { label: 'Outstanding', value: fmt(totalOutstanding), color: 'red' },
              ].map(kpi => (
                <div key={kpi.label} className={`bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-${kpi.color}-500`}>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{kpi.label}</div>
                  <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpi.value}</div>
                </div>
              ))}
            </div>

            {/* Action bar */}
            <div className="flex justify-end py-2 -mx-3 md:-mx-6 px-4 border-x border-b border-slate-300 bg-slate-100">
              <button onClick={() => { resetCForm(); setShowForm(true); }} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">+ New Contractor</button>
            </div>

            {/* Table */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    {['Code', 'Name', 'PAN', 'Type', 'Category', 'TDS', 'Phone', 'Bank', 'Outstanding', 'Bills', 'Actions'].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {contractors.map((c, i) => (
                    <tr key={c.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 font-mono text-slate-500 border-r border-slate-100">{c.contractorCode}</td>
                      <td className="px-3 py-1.5 font-medium text-slate-800 border-r border-slate-100">{c.name}</td>
                      <td className="px-3 py-1.5 font-mono border-r border-slate-100">{c.pan}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${c.panType === 'INDIVIDUAL' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-violet-300 bg-violet-50 text-violet-700'}`}>
                          {c.panType}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{c.contractorType}</td>
                      <td className="px-3 py-1.5 font-mono border-r border-slate-100">{c.tdsPercent}%</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">{c.phone || '--'}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 text-[10px]">{c.bankAccount ? `${c.bankName || ''} ...${c.bankAccount.slice(-4)}` : '--'}</td>
                      <td className={`px-3 py-1.5 font-mono tabular-nums border-r border-slate-100 ${c.outstanding > 0 ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>{fmt(c.outstanding)}</td>
                      <td className="px-3 py-1.5 text-center border-r border-slate-100">{c._count.bills}</td>
                      <td className="px-3 py-1.5">
                        <button onClick={() => openEdit(c)} className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] hover:bg-slate-50">Edit</button>
                      </td>
                    </tr>
                  ))}
                  {contractors.length === 0 && (
                    <tr><td colSpan={11} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No contractors found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* ══════════ TAB 2: BILLS ══════════ */}
        {tab === 'bills' && (
          <>
            {/* KPI Strip */}
            <div className="grid grid-cols-4 border-x border-b border-slate-300 -mx-3 md:-mx-6">
              {[
                { label: 'Total Bills', value: billStats.total, color: 'blue' },
                { label: 'Draft', value: billStats.draft, color: 'slate' },
                { label: 'Outstanding', value: fmt(billStats.outstanding), color: 'amber' },
                { label: 'Paid', value: fmt(billStats.paid), color: 'emerald' },
              ].map(kpi => (
                <div key={kpi.label} className={`bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-${kpi.color}-500`}>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{kpi.label}</div>
                  <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpi.value}</div>
                </div>
              ))}
            </div>

            {/* Action bar */}
            <div className="flex justify-end py-2 -mx-3 md:-mx-6 px-4 border-x border-b border-slate-300 bg-slate-100">
              <button onClick={() => { resetBillForm(); setShowBillForm(true); }} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">+ Create Bill</button>
            </div>

            {/* Bills Table */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    {['Bill#', 'Date', 'Contractor', 'Path', 'Description', 'Subtotal', 'GST', 'TDS', 'Net Payable', 'Paid', 'Balance', 'Status', 'Actions'].map(h => (
                      <th key={h} className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bills.map((b, i) => (
                    <tr key={b.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-1.5 font-mono font-semibold border-r border-slate-100">{b.billNo}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(b.billDate)}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100 font-medium">{b.contractor.name}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${b.billPath === 'CREATED' ? 'border-blue-300 bg-blue-50 text-blue-700' : 'border-orange-300 bg-orange-50 text-orange-700'}`}>
                          {b.billPath}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 border-r border-slate-100 max-w-[200px] truncate">{b.description}</td>
                      <td className="px-3 py-1.5 font-mono tabular-nums text-right border-r border-slate-100">{fmt(b.subtotal)}</td>
                      <td className="px-3 py-1.5 font-mono tabular-nums text-right border-r border-slate-100">{fmt(b.cgstAmount + b.sgstAmount + b.igstAmount)}</td>
                      <td className="px-3 py-1.5 font-mono tabular-nums text-right border-r border-slate-100 text-red-600">{fmt(b.tdsAmount)}</td>
                      <td className="px-3 py-1.5 font-mono tabular-nums text-right border-r border-slate-100 font-semibold">{fmt(b.netPayable)}</td>
                      <td className="px-3 py-1.5 font-mono tabular-nums text-right border-r border-slate-100 text-emerald-600">{fmt(b.paidAmount)}</td>
                      <td className={`px-3 py-1.5 font-mono tabular-nums text-right border-r border-slate-100 ${b.balanceAmount > 0 ? 'text-red-600 font-semibold' : 'text-slate-400'}`}>{fmt(b.balanceAmount)}</td>
                      <td className="px-3 py-1.5 border-r border-slate-100"><StatusBadge status={b.status} /></td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <div className="flex gap-1">
                          {b.status === 'DRAFT' && (
                            <>
                              <button onClick={() => confirmBill(b.id)} className="px-2 py-0.5 bg-blue-600 text-white text-[10px] hover:bg-blue-700">Confirm</button>
                              <button onClick={() => cancelBill(b.id)} className="px-2 py-0.5 bg-white border border-red-300 text-red-600 text-[10px] hover:bg-red-50">Cancel</button>
                            </>
                          )}
                          {['CONFIRMED', 'PARTIAL_PAID'].includes(b.status) && (
                            <button onClick={() => openPay(b)} className="px-2 py-0.5 bg-emerald-600 text-white text-[10px] hover:bg-emerald-700">Pay</button>
                          )}
                          {b.billPath === 'CREATED' && (
                            <button onClick={() => openPrint(b.id)} className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] hover:bg-slate-50">Print</button>
                          )}
                          {b.billPath === 'UPLOADED' && !b.documentUrl && (
                            <button onClick={() => { setUploadBillId(b.id); fileRef.current?.click(); }} className="px-2 py-0.5 bg-white border border-orange-300 text-orange-600 text-[10px] hover:bg-orange-50">Upload</button>
                          )}
                          {b.documentUrl && (
                            <a href={b.documentUrl} target="_blank" rel="noopener noreferrer" className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] hover:bg-slate-50">View</a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {bills.length === 0 && (
                    <tr><td colSpan={13} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No bills found</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            {/* Hidden file input */}
            <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={(e) => {
              if (e.target.files?.[0] && uploadBillId) { uploadDoc(uploadBillId, e.target.files[0]); setUploadBillId(null); }
              e.target.value = '';
            }} />
          </>
        )}

        {/* ══════════ TAB 3: PAYMENTS ══════════ */}
        {tab === 'payments' && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  {['Date', 'Contractor', 'Bill#', 'Amount', 'TDS', 'Mode', 'Reference', 'Status'].map(h => (
                    <th key={h} className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={p.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(p.paymentDate)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-medium">{p.contractor.name}</td>
                    <td className="px-3 py-1.5 font-mono border-r border-slate-100">{p.bill ? `#${p.bill.billNo}` : '--'}</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums text-right border-r border-slate-100 font-semibold">{fmt(p.amount)}</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums text-right border-r border-slate-100 text-red-600">{fmt(p.tdsDeducted)}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">{p.paymentMode}</td>
                    <td className="px-3 py-1.5 font-mono border-r border-slate-100">{p.paymentRef || '--'}</td>
                    <td className="px-3 py-1.5"><StatusBadge status={p.paymentStatus} /></td>
                  </tr>
                ))}
                {payments.length === 0 && (
                  <tr><td colSpan={8} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No payments found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ══════════ CONTRACTOR MODAL ══════════ */}
        {showForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
            <div className="bg-white shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-4 py-2.5 flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-widest">{editId ? 'Edit Contractor' : 'New Contractor'}</span>
                <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white text-lg">&times;</button>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Name *</label>
                    <input value={cForm.name} onChange={e => setCForm({ ...cForm, name: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Trade / Firm Name</label>
                    <input value={cForm.tradeName} onChange={e => setCForm({ ...cForm, tradeName: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">PAN *</label>
                    <input value={cForm.pan} onChange={e => setCForm({ ...cForm, pan: e.target.value.toUpperCase() })} maxLength={10} className={`w-full border px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400 ${cForm.pan.length > 0 && cForm.pan.length !== 10 ? 'border-red-400' : 'border-slate-300'}`} placeholder="ABCPD1234E" />
                    {cForm.pan.length > 0 && cForm.pan.length !== 10 && (
                      <div className="mt-0.5 text-[9px] text-red-500 font-medium">PAN must be exactly 10 characters ({cForm.pan.length}/10)</div>
                    )}
                    {cForm.pan.length >= 4 && (
                      <div className="mt-1">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${panInfo.panType === 'INDIVIDUAL' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-violet-300 bg-violet-50 text-violet-700'}`}>
                          {panInfo.panType} &mdash; {panInfo.tdsPercent}% TDS u/s 194C
                        </span>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">GSTIN</label>
                    <input value={cForm.gstin} onChange={e => setCForm({ ...cForm, gstin: e.target.value.toUpperCase() })} maxLength={15} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Optional" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Category</label>
                    <select value={cForm.contractorType} onChange={e => setCForm({ ...cForm, contractorType: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                      {TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Phone</label>
                    <input value={cForm.phone} onChange={e => setCForm({ ...cForm, phone: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Address</label>
                    <input value={cForm.address} onChange={e => setCForm({ ...cForm, address: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                {/* Bank Details */}
                <div className="border-t border-slate-200 pt-3">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2">Bank Details</div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Bank Name</label>
                      <input value={cForm.bankName} onChange={e => setCForm({ ...cForm, bankName: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">IFSC</label>
                      <input value={cForm.bankIfsc} onChange={e => setCForm({ ...cForm, bankIfsc: e.target.value.toUpperCase() })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                    <div className="col-span-2">
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Account Number</label>
                      <input value={cForm.bankAccount} onChange={e => setCForm({ ...cForm, bankAccount: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                  <button onClick={() => setShowForm(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                  <button onClick={saveContractor} disabled={!cForm.name || cForm.pan.length !== 10} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                    {editId ? 'Update' : 'Create'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ BILL CREATE MODAL ══════════ */}
        {showBillForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowBillForm(false)}>
            <div className="bg-white shadow-2xl w-full max-w-3xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-4 py-2.5 flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-widest">Create Contractor Bill</span>
                <button onClick={() => setShowBillForm(false)} className="text-slate-400 hover:text-white text-lg">&times;</button>
              </div>
              <div className="p-4 space-y-3">
                {/* Bill path toggle */}
                <div className="flex gap-2 mb-2">
                  <button onClick={() => setBillPath('CREATED')} className={`px-3 py-1 text-[11px] font-bold uppercase tracking-widest border ${billPath === 'CREATED' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-slate-500 border-slate-300'}`}>
                    Create for Contractor
                  </button>
                  <button onClick={() => setBillPath('UPLOADED')} className={`px-3 py-1 text-[11px] font-bold uppercase tracking-widest border ${billPath === 'UPLOADED' ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-slate-500 border-slate-300'}`}>
                    Upload Their Bill
                  </button>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Contractor *</label>
                    <select value={billForm.contractorId} onChange={e => setBillForm({ ...billForm, contractorId: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="">Select...</option>
                      {contractors.filter(c => c.isActive).map(c => (
                        <option key={c.id} value={c.id}>{c.name} ({c.contractorCode})</option>
                      ))}
                    </select>
                    {selectedContractor && (
                      <div className="mt-1">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${selectedContractor.panType === 'INDIVIDUAL' ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-violet-300 bg-violet-50 text-violet-700'}`}>
                          {selectedContractor.panType} &mdash; {selectedContractor.tdsPercent}% TDS
                        </span>
                      </div>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Bill Date</label>
                    <input type="date" value={billForm.billDate} onChange={e => setBillForm({ ...billForm, billDate: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  {billPath === 'UPLOADED' && (
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Their Bill No</label>
                      <input value={billForm.vendorBillNo} onChange={e => setBillForm({ ...billForm, vendorBillNo: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                  )}
                </div>

                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Description *</label>
                  <input value={billForm.description} onChange={e => setBillForm({ ...billForm, description: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Summary of work done" />
                </div>

                {/* CREATED path: line items */}
                {billPath === 'CREATED' && (
                  <div>
                    <div className="flex justify-between items-center mb-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Line Items</span>
                      <button onClick={addLine} className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] hover:bg-slate-50">+ Add Line</button>
                    </div>
                    <div className="border border-slate-300">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-slate-100">
                            <th className="text-left px-2 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest">Description</th>
                            <th className="text-left px-2 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest w-20">Qty</th>
                            <th className="text-left px-2 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest w-20">Unit</th>
                            <th className="text-left px-2 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest w-24">Rate</th>
                            <th className="text-right px-2 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest w-24">Amount</th>
                            <th className="w-8"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {billLines.map((line, i) => (
                            <tr key={i} className="border-t border-slate-200">
                              <td className="px-1 py-1"><input value={line.description} onChange={e => updateLine(i, 'description', e.target.value)} className="w-full border border-slate-200 px-1.5 py-1 text-xs" placeholder="Work description" /></td>
                              <td className="px-1 py-1"><input type="number" value={line.quantity} onChange={e => updateLine(i, 'quantity', parseFloat(e.target.value) || 0)} className="w-full border border-slate-200 px-1.5 py-1 text-xs font-mono" /></td>
                              <td className="px-1 py-1">
                                <select value={line.unit} onChange={e => updateLine(i, 'unit', e.target.value)} className="w-full border border-slate-200 px-1 py-1 text-xs">
                                  {UNITS.map(u => <option key={u} value={u}>{u}</option>)}
                                </select>
                              </td>
                              <td className="px-1 py-1"><input type="number" value={line.rate} onChange={e => updateLine(i, 'rate', parseFloat(e.target.value) || 0)} className="w-full border border-slate-200 px-1.5 py-1 text-xs font-mono" /></td>
                              <td className="px-2 py-1 text-right font-mono tabular-nums">{fmt(line.amount)}</td>
                              <td className="px-1 py-1 text-center">
                                {billLines.length > 1 && <button onClick={() => removeLine(i)} className="text-red-400 hover:text-red-600 text-sm">&times;</button>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* UPLOADED path: manual subtotal */}
                {billPath === 'UPLOADED' && (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Subtotal (Base Amount) *</label>
                      <input type="number" value={billForm.subtotal} onChange={e => setBillForm({ ...billForm, subtotal: parseFloat(e.target.value) || 0 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                    </div>
                  </div>
                )}

                {/* GST inputs */}
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">CGST %</label>
                    <input type="number" value={billForm.cgstPercent} onChange={e => setBillForm({ ...billForm, cgstPercent: parseFloat(e.target.value) || 0 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">SGST %</label>
                    <input type="number" value={billForm.sgstPercent} onChange={e => setBillForm({ ...billForm, sgstPercent: parseFloat(e.target.value) || 0 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">IGST %</label>
                    <input type="number" value={billForm.igstPercent} onChange={e => setBillForm({ ...billForm, igstPercent: parseFloat(e.target.value) || 0 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>

                {/* Summary */}
                <div className="bg-slate-50 border border-slate-300 p-3">
                  <div className="grid grid-cols-5 gap-4 text-xs">
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Subtotal</div>
                      <div className="font-mono tabular-nums font-bold mt-0.5">{fmt(billSubtotal)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">GST</div>
                      <div className="font-mono tabular-nums font-bold mt-0.5">{fmt(billCgst + billSgst + billIgst)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</div>
                      <div className="font-mono tabular-nums font-bold mt-0.5">{fmt(billTotal)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-red-400 uppercase tracking-widest">TDS ({billTdsPercent}%)</div>
                      <div className="font-mono tabular-nums font-bold mt-0.5 text-red-600">-{fmt(billTds)}</div>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Net Payable</div>
                      <div className="font-mono tabular-nums font-bold mt-0.5 text-emerald-700 text-lg">{fmt(billNet)}</div>
                    </div>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                  <button onClick={() => setShowBillForm(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                  <button onClick={saveBill} disabled={!billForm.contractorId || !billForm.description || billSubtotal <= 0} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                    Save as Draft
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ PAY MODAL ══════════ */}
        {showPayModal && payBill && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowPayModal(false)}>
            <div className="bg-white shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-4 py-2.5 flex justify-between items-center">
                <span className="text-xs font-bold uppercase tracking-widest">Record Payment — Bill #{payBill.billNo}</span>
                <button onClick={() => setShowPayModal(false)} className="text-slate-400 hover:text-white text-lg">&times;</button>
              </div>
              <div className="p-4 space-y-3">
                <div className="bg-slate-50 border border-slate-300 p-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Contractor</span>
                    <span className="font-medium">{payBill.contractor.name}</span>
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-slate-500">Balance</span>
                    <span className="font-mono font-bold text-red-600">{fmt(payBill.balanceAmount)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Amount *</label>
                    <input type="number" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: parseFloat(e.target.value) || 0 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">TDS Deducted</label>
                    <input type="number" value={payForm.tdsDeducted} onChange={e => setPayForm({ ...payForm, tdsDeducted: parseFloat(e.target.value) || 0 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Mode</label>
                    <select value={payForm.paymentMode} onChange={e => setPayForm({ ...payForm, paymentMode: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                      {PAY_MODES.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">UTR / Ref</label>
                    <input value={payForm.paymentRef} onChange={e => setPayForm({ ...payForm, paymentRef: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Date</label>
                    <input type="date" value={payForm.paymentDate} onChange={e => setPayForm({ ...payForm, paymentDate: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                  <button onClick={() => setShowPayModal(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                  <button onClick={submitPay} disabled={payForm.amount <= 0} className="px-3 py-1 bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 disabled:opacity-50">
                    Record Payment {fmt(payForm.amount)}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════ PRINT MODAL ══════════ */}
        {showPrint && printData && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowPrint(false)}>
            <div className="bg-white shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-4 py-2.5 flex justify-between items-center no-print">
                <span className="text-xs font-bold uppercase tracking-widest">Bill Preview</span>
                <div className="flex gap-2">
                  <button onClick={() => window.print()} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">Print</button>
                  <button onClick={() => setShowPrint(false)} className="text-slate-400 hover:text-white text-lg">&times;</button>
                </div>
              </div>
              <div className="p-8 print:p-4" id="printable-bill">
                {/* Company Header */}
                <div className="text-center border-b-2 border-black pb-3 mb-4">
                  <div className="text-sm font-bold uppercase">{printData.company.name}</div>
                  <div className="text-[10px] text-slate-600">{printData.company.address}</div>
                  <div className="text-[10px] text-slate-600">GSTIN: {printData.company.gstin}</div>
                </div>
                <div className="text-center font-bold text-xs uppercase tracking-widest mb-4">Contractor Bill</div>

                {/* Bill Info */}
                <div className="grid grid-cols-2 gap-4 text-xs mb-4">
                  <div>
                    <div><span className="font-bold">Bill No:</span> {printData.bill.billNo}</div>
                    <div><span className="font-bold">Date:</span> {fmtDate(printData.bill.billDate)}</div>
                  </div>
                  <div className="text-right">
                    <div><span className="font-bold">Contractor:</span> {printData.bill.contractor.name}</div>
                    <div><span className="font-bold">PAN:</span> {printData.bill.contractor.pan}</div>
                    {printData.bill.contractor.gstin && <div><span className="font-bold">GSTIN:</span> {printData.bill.contractor.gstin}</div>}
                  </div>
                </div>

                {/* Description */}
                <div className="text-xs mb-3">
                  <span className="font-bold">Work Description:</span> {printData.bill.description}
                </div>

                {/* Line Items */}
                {printData.bill.lines.length > 0 && (
                  <table className="w-full text-xs border border-black mb-4">
                    <thead>
                      <tr className="bg-slate-100">
                        <th className="border border-black px-2 py-1 text-left">#</th>
                        <th className="border border-black px-2 py-1 text-left">Description</th>
                        <th className="border border-black px-2 py-1 text-right">Qty</th>
                        <th className="border border-black px-2 py-1">Unit</th>
                        <th className="border border-black px-2 py-1 text-right">Rate</th>
                        <th className="border border-black px-2 py-1 text-right">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {printData.bill.lines.map((l: BillLine, i: number) => (
                        <tr key={i}>
                          <td className="border border-black px-2 py-1">{i + 1}</td>
                          <td className="border border-black px-2 py-1">{l.description}</td>
                          <td className="border border-black px-2 py-1 text-right font-mono">{l.quantity}</td>
                          <td className="border border-black px-2 py-1 text-center">{l.unit}</td>
                          <td className="border border-black px-2 py-1 text-right font-mono">{fmt(l.rate)}</td>
                          <td className="border border-black px-2 py-1 text-right font-mono">{fmt(l.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}

                {/* Summary */}
                <div className="flex justify-end">
                  <div className="w-64 text-xs">
                    <div className="flex justify-between py-1 border-b"><span>Subtotal</span><span className="font-mono">{fmt(printData.bill.subtotal)}</span></div>
                    {printData.bill.cgstAmount > 0 && <div className="flex justify-between py-1 border-b"><span>CGST @{printData.bill.cgstPercent}%</span><span className="font-mono">{fmt(printData.bill.cgstAmount)}</span></div>}
                    {printData.bill.sgstAmount > 0 && <div className="flex justify-between py-1 border-b"><span>SGST @{printData.bill.sgstPercent}%</span><span className="font-mono">{fmt(printData.bill.sgstAmount)}</span></div>}
                    {printData.bill.igstAmount > 0 && <div className="flex justify-between py-1 border-b"><span>IGST @{printData.bill.igstPercent}%</span><span className="font-mono">{fmt(printData.bill.igstAmount)}</span></div>}
                    <div className="flex justify-between py-1 border-b font-bold"><span>Total</span><span className="font-mono">{fmt(printData.bill.totalAmount)}</span></div>
                    <div className="flex justify-between py-1 border-b text-red-600"><span>TDS @{printData.bill.tdsPercent}% u/s 194C</span><span className="font-mono">-{fmt(printData.bill.tdsAmount)}</span></div>
                    <div className="flex justify-between py-1 font-bold text-sm"><span>Net Payable</span><span className="font-mono">{fmt(printData.bill.netPayable)}</span></div>
                  </div>
                </div>

                {/* Signature */}
                <div className="grid grid-cols-2 gap-8 mt-12 text-xs">
                  <div className="text-center">
                    <div className="border-t border-black pt-1">Contractor Signature</div>
                  </div>
                  <div className="text-center">
                    <div className="border-t border-black pt-1">Authorized Signatory</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
