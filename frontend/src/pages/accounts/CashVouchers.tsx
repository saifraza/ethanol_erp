import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';

interface CashVoucher {
  id: string;
  voucherNo: number;
  date: string;
  type: string;
  payeeName: string;
  payeePhone: string | null;
  purpose: string;
  category: string;
  amount: number;
  paymentMode: string;
  paymentRef: string | null;
  authorizedBy: string;
  status: string;
  settlementDate: string | null;
  settlementNote: string | null;
  userId: string;
  createdAt: string;
}

interface Summary {
  unsettledAmount: number;
  monthTotal: number;
  activeCount: number;
  settledCount: number;
}

const CATEGORIES: { value: string; label: string }[] = [
  { value: 'LABOUR', label: 'Labour' },
  { value: 'TRANSPORT', label: 'Transport / Freight' },
  { value: 'REPAIR', label: 'Repair / Maintenance' },
  { value: 'MATERIAL', label: 'Material / Supplies' },
  { value: 'FUEL', label: 'Fuel Purchase' },
  { value: 'OFFICE', label: 'Office / Admin' },
  { value: 'MISC', label: 'Miscellaneous' },
];
const categoryLabel = (val: string): string => CATEGORIES.find(c => c.value === val)?.label || val;

const PAYMENT_MODES: { value: string; label: string }[] = [
  { value: 'CASH', label: 'Cash' },
  { value: 'UPI', label: 'UPI' },
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
];

const TYPES = [
  { value: 'PAYMENT', label: 'Payment' },
  { value: 'ADVANCE', label: 'Advance' },
  { value: 'RECEIPT', label: 'Receipt' },
  { value: 'REFUND', label: 'Refund' },
];

const STATUS_COLORS: Record<string, string> = {
  ACTIVE: 'border-green-400 bg-green-50 text-green-700',
  SETTLED: 'border-slate-400 bg-slate-50 text-slate-600',
  CANCELLED: 'border-red-400 bg-red-50 text-red-700',
};

const emptyForm = {
  payeeName: '',
  amount: '',
  purpose: '',
  category: 'MISC',
  paymentMode: 'CASH',
  authorizedBy: '',
  type: 'PAYMENT',
  payeePhone: '',
  paymentRef: '',
};

export default function CashVouchers() {
  const [vouchers, setVouchers] = useState<CashVoucher[]>([]);
  const [summary, setSummary] = useState<Summary>({ unsettledAmount: 0, monthTotal: 0, activeCount: 0, settledCount: 0 });
  const [loading, setLoading] = useState(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [typeFilter, setTypeFilter] = useState('ALL');
  const [purposeFilter, setPurposeFilter] = useState<'ALL' | 'FUEL' | 'RAW_MATERIAL' | 'CONTRACTOR'>('ALL');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Modals
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showSettleModal, setShowSettleModal] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [selectedVoucher, setSelectedVoucher] = useState<CashVoucher | null>(null);

  // Client-side purpose bucket filter (Fuel/RM/Contractor) — keyword based since
  // CashVoucher has no FK to vendor/contractor; we infer from category + purpose text.
  const filteredVouchers = useMemo(() => {
    if (purposeFilter === 'ALL') return vouchers;
    const FUEL_KW = ['coal', 'husk', 'bagasse', 'mustard', 'furnace', 'diesel', 'hsd', 'lfo', 'hfo', 'biomass', 'fuel'];
    const RM_KW = ['maize', 'corn', 'broken rice', 'grain', 'sorghum', 'molasses', 'rice'];
    const CONTRACT_KW = ['contractor', 'contract', 'labour', 'labor', 'civil', 'manpower'];
    return vouchers.filter((v) => {
      const text = `${v.purpose || ''} ${v.payeeName || ''}`.toLowerCase();
      const cat = (v.category || '').toUpperCase();
      if (purposeFilter === 'FUEL') return cat === 'FUEL' || FUEL_KW.some(k => text.includes(k));
      if (purposeFilter === 'RAW_MATERIAL') return cat === 'MATERIAL' || RM_KW.some(k => text.includes(k));
      if (purposeFilter === 'CONTRACTOR') return cat === 'LABOUR' || CONTRACT_KW.some(k => text.includes(k));
      return true;
    });
  }, [vouchers, purposeFilter]);

  // Form state
  const [form, setForm] = useState(emptyForm);
  const [settleNote, setSettleNote] = useState('');
  const [linkedInvoiceId, setLinkedInvoiceId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { limit: '200' };
      if (statusFilter !== 'ALL') params.status = statusFilter;
      if (typeFilter !== 'ALL') params.type = typeFilter;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;

      const [vRes, sRes] = await Promise.all([
        api.get<{ items: CashVoucher[]; total: number }>('/cash-vouchers', { params }),
        api.get<Summary>('/cash-vouchers/summary', { params }),
      ]);
      setVouchers(vRes.data.items);
      setSummary(sRes.data);
    } catch (err) {
      console.error('Failed to fetch cash vouchers:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fmtCurrency = (n: number): string => {
    if (n === 0) return '--';
    return '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const fmtDate = (d: string): string => {
    const dt = new Date(d);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  // Create voucher
  const handleCreate = async () => {
    if (!form.payeeName.trim() || !form.amount || !form.purpose.trim() || !form.authorizedBy.trim()) return;
    try {
      setSubmitting(true);
      await api.post('/cash-vouchers', {
        payeeName: form.payeeName.trim(),
        amount: parseFloat(form.amount),
        purpose: form.purpose.trim(),
        category: form.category,
        paymentMode: form.paymentMode,
        authorizedBy: form.authorizedBy.trim(),
        type: form.type,
        payeePhone: form.payeePhone.trim() || null,
        paymentRef: form.paymentRef.trim() || null,
      });
      setShowCreateModal(false);
      setForm(emptyForm);
      fetchData();
    } catch (err) {
      console.error('Failed to create voucher:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Settle voucher
  const handleSettle = async () => {
    if (!selectedVoucher || !settleNote.trim()) return;
    try {
      setSubmitting(true);
      await api.put(`/cash-vouchers/${selectedVoucher.id}/settle`, {
        settlementNote: settleNote.trim(),
        linkedInvoiceId: linkedInvoiceId.trim() || undefined,
      });
      setShowSettleModal(false);
      setSettleNote('');
      setLinkedInvoiceId('');
      setSelectedVoucher(null);
      fetchData();
    } catch (err) {
      console.error('Failed to settle voucher:', err);
    } finally {
      setSubmitting(false);
    }
  };

  // Cancel voucher
  const handleCancel = async () => {
    if (!selectedVoucher) return;
    try {
      setSubmitting(true);
      await api.delete(`/cash-vouchers/${selectedVoucher.id}`);
      setShowCancelConfirm(false);
      setSelectedVoucher(null);
      fetchData();
    } catch (err) {
      console.error('Failed to cancel voucher:', err);
    } finally {
      setSubmitting(false);
    }
  };

  const openSettle = (v: CashVoucher) => {
    setSelectedVoucher(v);
    setSettleNote('');
    setLinkedInvoiceId('');
    setShowSettleModal(true);
  };

  const openCancel = (v: CashVoucher) => {
    setSelectedVoucher(v);
    setShowCancelConfirm(true);
  };

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
        {/* Page Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Cash Vouchers</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Petty Cash & Advance Payments</span>
          </div>
          <button
            onClick={() => { setForm(emptyForm); setShowCreateModal(true); }}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
          >
            + New Voucher
          </button>
        </div>

        {/* Filter Bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
          {/* Status Filter */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mr-1">Status</span>
            {['ALL', 'ACTIVE', 'SETTLED', 'CANCELLED'].map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${
                  statusFilter === s
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {s}
              </button>
            ))}
          </div>

          {/* Purpose Filter — match Payments Out buckets */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mr-1">For</span>
            {(['ALL', 'FUEL', 'RAW_MATERIAL', 'CONTRACTOR'] as const).map((p) => (
              <button
                key={p}
                onClick={() => setPurposeFilter(p)}
                className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${
                  purposeFilter === p
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {p === 'RAW_MATERIAL' ? 'RM' : p}
              </button>
            ))}
          </div>

          {/* Type Filter */}
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mr-1">Type</span>
            {['ALL', ...TYPES.map(t => t.value)].map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${
                  typeFilter === t
                    ? 'bg-slate-800 text-white border-slate-800'
                    : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">From</span>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="border border-slate-300 px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">To</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="border border-slate-300 px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
            />
            {(dateFrom || dateTo) && (
              <button
                onClick={() => { setDateFrom(''); setDateTo(''); }}
                className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Unsettled Amount</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(summary.unsettledAmount)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">This Month Total</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(summary.monthTotal)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Count</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.activeCount}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-slate-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Settled Count</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.settledCount}</div>
          </div>
        </div>

        {/* Data Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-14">#</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Payee</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Purpose</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Category</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-28">Amount</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Mode</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-28">Authorized By</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Status</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredVouchers.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">
                    No vouchers found
                  </td>
                </tr>
              ) : (
                filteredVouchers.map((v, i) => (
                  <tr key={v.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 text-slate-500 font-mono border-r border-slate-100">{v.voucherNo}</td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 whitespace-nowrap">{fmtDate(v.date)}</td>
                    <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">
                      {v.payeeName}
                      {v.payeePhone && <span className="text-slate-400 ml-1 font-normal">({v.payeePhone})</span>}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{v.purpose}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{categoryLabel(v.category)}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 border-r border-slate-100">{fmtCurrency(v.amount)}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{v.paymentMode}</td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{v.authorizedBy}</td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_COLORS[v.status] || 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                        {v.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      {v.status === 'ACTIVE' && (
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => openSettle(v)}
                            className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700"
                          >
                            Settle
                          </button>
                          <button
                            onClick={() => openCancel(v)}
                            className="px-2 py-0.5 bg-white border border-red-300 text-red-600 text-[10px] font-medium hover:bg-red-50"
                          >
                            Cancel
                          </button>
                        </div>
                      )}
                      {v.status === 'SETTLED' && v.settlementNote && (
                        <span className="text-[10px] text-slate-400" title={v.settlementNote}>
                          {v.settlementNote.length > 20 ? v.settlementNote.slice(0, 20) + '...' : v.settlementNote}
                        </span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Table Footer */}
        {filteredVouchers.length > 0 && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-800 text-white px-3 py-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-widest">
              {filteredVouchers.length} voucher{filteredVouchers.length !== 1 ? 's' : ''}{purposeFilter !== 'ALL' ? ` (${purposeFilter === 'RAW_MATERIAL' ? 'RM' : purposeFilter})` : ''}
            </span>
            <span className="text-[10px] font-bold uppercase tracking-widest font-mono tabular-nums">
              Total: {fmtCurrency(filteredVouchers.reduce((sum, v) => sum + v.amount, 0))}
            </span>
          </div>
        )}
      </div>

      {/* ========== Create Voucher Modal ========== */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white shadow-2xl w-full max-w-lg">
            {/* Modal Header */}
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest">New Cash Voucher</h2>
              <button onClick={() => setShowCreateModal(false)} className="text-slate-400 hover:text-white text-sm">X</button>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-3">
              {/* Type */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Voucher Type</label>
                <select
                  value={form.type}
                  onChange={(e) => setForm({ ...form, type: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                >
                  {TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>

              {/* Payee + Phone */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payee Name *</label>
                  <input
                    type="text"
                    value={form.payeeName}
                    onChange={(e) => setForm({ ...form, payeeName: e.target.value })}
                    placeholder="e.g. Rajesh Kumar"
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Phone</label>
                  <input
                    type="text"
                    value={form.payeePhone}
                    onChange={(e) => setForm({ ...form, payeePhone: e.target.value })}
                    placeholder="Optional"
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              {/* Amount + Mode */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Amount (INR) *</label>
                  <input
                    type="number"
                    value={form.amount}
                    onChange={(e) => setForm({ ...form, amount: e.target.value })}
                    placeholder="0.00"
                    min="0"
                    step="0.01"
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Mode</label>
                  <select
                    value={form.paymentMode}
                    onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    {PAYMENT_MODES.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Purpose */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Purpose *</label>
                <input
                  type="text"
                  value={form.purpose}
                  onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                  placeholder="e.g. Purchase of cleaning supplies"
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>

              {/* Category + Authorized By */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Category</label>
                  <select
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>{c.label}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Authorized By *</label>
                  <input
                    type="text"
                    value={form.authorizedBy}
                    onChange={(e) => setForm({ ...form, authorizedBy: e.target.value })}
                    placeholder="e.g. Plant Manager"
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              {/* Payment Ref */}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Payment Reference</label>
                <input
                  type="text"
                  value={form.paymentRef}
                  onChange={(e) => setForm({ ...form, paymentRef: e.target.value })}
                  placeholder="Cheque no. / UPI ref (optional)"
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-slate-200 px-4 py-3 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowCreateModal(false)}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={submitting || !form.payeeName.trim() || !form.amount || !form.purpose.trim() || !form.authorizedBy.trim()}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Creating...' : 'Create Voucher'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== Settle Modal ========== */}
      {showSettleModal && selectedVoucher && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white shadow-2xl w-full max-w-md">
            {/* Modal Header */}
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest">Settle Voucher #{selectedVoucher.voucherNo}</h2>
              <button onClick={() => setShowSettleModal(false)} className="text-slate-400 hover:text-white text-sm">X</button>
            </div>

            {/* Voucher Summary */}
            <div className="border-b border-slate-200 px-4 py-3 bg-slate-50">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Payee</span>
                  <div className="text-slate-800 font-medium mt-0.5">{selectedVoucher.payeeName}</div>
                </div>
                <div>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Amount</span>
                  <div className="text-slate-800 font-medium font-mono tabular-nums mt-0.5">{fmtCurrency(selectedVoucher.amount)}</div>
                </div>
                <div className="col-span-2">
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Purpose</span>
                  <div className="text-slate-700 mt-0.5">{selectedVoucher.purpose}</div>
                </div>
              </div>
            </div>

            {/* Modal Body */}
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Settlement Note *</label>
                <textarea
                  value={settleNote}
                  onChange={(e) => setSettleNote(e.target.value)}
                  rows={3}
                  placeholder="e.g. Receipt submitted, verified by accounts"
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Linked Invoice ID</label>
                <input
                  type="text"
                  value={linkedInvoiceId}
                  onChange={(e) => setLinkedInvoiceId(e.target.value)}
                  placeholder="Optional invoice reference"
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                />
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-slate-200 px-4 py-3 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowSettleModal(false)}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSettle}
                disabled={submitting || !settleNote.trim()}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {submitting ? 'Settling...' : 'Settle Voucher'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ========== Cancel Confirmation ========== */}
      {showCancelConfirm && selectedVoucher && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white shadow-2xl w-full max-w-sm">
            {/* Modal Header */}
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <h2 className="text-xs font-bold uppercase tracking-widest">Confirm Cancellation</h2>
            </div>

            {/* Modal Body */}
            <div className="p-4">
              <p className="text-xs text-slate-700">
                Are you sure you want to cancel voucher <strong>#{selectedVoucher.voucherNo}</strong> for{' '}
                <strong className="font-mono">{fmtCurrency(selectedVoucher.amount)}</strong> to{' '}
                <strong>{selectedVoucher.payeeName}</strong>?
              </p>
              <p className="text-[10px] text-slate-400 mt-2 uppercase tracking-widest">This action cannot be undone.</p>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-slate-200 px-4 py-3 flex items-center justify-end gap-2">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
              >
                Go Back
              </button>
              <button
                onClick={handleCancel}
                disabled={submitting}
                className="px-3 py-1 bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 disabled:opacity-50"
              >
                {submitting ? 'Cancelling...' : 'Cancel Voucher'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
