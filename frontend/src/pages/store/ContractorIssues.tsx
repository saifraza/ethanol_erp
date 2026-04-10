import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface IssueLine {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  returnedQty: number;
  remarks?: string;
}

interface ContractorIssue {
  id: string;
  issueNo: number;
  issueDate: string;
  contractorId: string;
  contractor: { id: string; name: string };
  subtotal: number;
  chargePercent: number;
  chargeAmount: number;
  totalAmount: number;
  status: string;
  purpose?: string;
  remarks?: string;
  lines: IssueLine[];
  linesCount?: number;
  confirmedAt?: string;
  returnedAt?: string;
  returnRemarks?: string;
}

interface ContractorOption {
  id: string;
  name: string;
}

interface DraftLine {
  description: string;
  quantity: number;
  unit: string;
  rate: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const fmtCurrency = (n: number) =>
  n === 0 ? '--' : '₹' + n.toLocaleString('en-IN', { minimumFractionDigits: 2 });

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const statusColor: Record<string, string> = {
  DRAFT: 'border-slate-400 bg-slate-50 text-slate-600',
  CONFIRMED: 'border-blue-500 bg-blue-50 text-blue-700',
  RETURNED: 'border-green-500 bg-green-50 text-green-700',
  CANCELLED: 'border-red-500 bg-red-50 text-red-700',
};

const emptyLine = (): DraftLine => ({ description: '', quantity: 1, unit: 'Pcs', rate: 0 });

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function ContractorIssues() {
  /* --- state --- */
  const [data, setData] = useState<ContractorIssue[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [contractors, setContractors] = useState<ContractorOption[]>([]);

  // create/edit modal
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formContractorId, setFormContractorId] = useState('');
  const [formChargePercent, setFormChargePercent] = useState(5);
  const [formPurpose, setFormPurpose] = useState('');
  const [formLines, setFormLines] = useState<DraftLine[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  // detail modal
  const [detail, setDetail] = useState<ContractorIssue | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [returnRemarks, setReturnRemarks] = useState('');

  /* --- fetch list --- */
  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      const res = await api.get<ContractorIssue[]>('/contractor-store-issues', { params });
      setData(Array.isArray(res.data) ? res.data : (res.data as any).items ?? []);
    } catch (err) {
      console.error('Failed to fetch contractor issues:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchContractors = useCallback(async () => {
    try {
      const res = await api.get<ContractorOption[]>('/contractors', { params: { isActive: 'true' } });
      setContractors(Array.isArray(res.data) ? res.data : (res.data as any).items ?? []);
    } catch (err) {
      console.error('Failed to fetch contractors:', err);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchContractors(); }, [fetchContractors]);

  /* --- computed KPIs --- */
  const kpis = {
    total: data.length,
    draft: data.filter((d) => d.status === 'DRAFT').length,
    confirmed: data.filter((d) => d.status === 'CONFIRMED').length,
    totalValue: data.reduce((s, d) => s + d.totalAmount, 0),
  };

  /* --- form helpers --- */
  const lineSubtotal = formLines.reduce((s, l) => s + l.quantity * l.rate, 0);
  const lineChargeAmt = Math.round(lineSubtotal * formChargePercent) / 100;
  const lineTotal = lineSubtotal + lineChargeAmt;

  const updateLine = (idx: number, field: keyof DraftLine, value: string | number) => {
    setFormLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const removeLine = (idx: number) => {
    setFormLines((prev) => (prev.length === 1 ? [emptyLine()] : prev.filter((_, i) => i !== idx)));
  };

  const openCreateModal = () => {
    setEditId(null);
    setFormContractorId('');
    setFormChargePercent(5);
    setFormPurpose('');
    setFormLines([emptyLine()]);
    setShowForm(true);
  };

  const openEditModal = (issue: ContractorIssue) => {
    setEditId(issue.id);
    setFormContractorId(issue.contractorId);
    setFormChargePercent(issue.chargePercent);
    setFormPurpose(issue.purpose ?? '');
    setFormLines(
      issue.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unit: l.unit,
        rate: l.rate,
      }))
    );
    setShowDetail(false);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formContractorId) return;
    const validLines = formLines.filter((l) => l.description.trim() && l.quantity > 0 && l.rate > 0);
    if (validLines.length === 0) return;
    setSaving(true);
    try {
      const payload = {
        contractorId: formContractorId,
        chargePercent: formChargePercent,
        purpose: formPurpose || undefined,
        lines: validLines,
      };
      if (editId) {
        await api.put(`/contractor-store-issues/${editId}`, payload);
      } else {
        await api.post('/contractor-store-issues', payload);
      }
      setShowForm(false);
      fetchData();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  /* --- detail actions --- */
  const openDetail = async (id: string) => {
    try {
      const res = await api.get<ContractorIssue>(`/contractor-store-issues/${id}`);
      setDetail(res.data);
      setReturnRemarks('');
      setShowDetail(true);
    } catch (err) {
      console.error('Failed to load detail:', err);
    }
  };

  const confirmIssue = async () => {
    if (!detail) return;
    setActionLoading(true);
    try {
      await api.post(`/contractor-store-issues/${detail.id}/confirm`);
      setShowDetail(false);
      fetchData();
    } catch (err) {
      console.error('Confirm failed:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const markReturned = async () => {
    if (!detail) return;
    setActionLoading(true);
    try {
      await api.post(`/contractor-store-issues/${detail.id}/return`, { returnRemarks: returnRemarks || undefined });
      setShowDetail(false);
      fetchData();
    } catch (err) {
      console.error('Return failed:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const deleteIssue = async () => {
    if (!detail || detail.status !== 'DRAFT') return;
    if (!window.confirm('Delete this draft issue?')) return;
    setActionLoading(true);
    try {
      await api.delete(`/contractor-store-issues/${detail.id}`);
      setShowDetail(false);
      fetchData();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setActionLoading(false);
    }
  };

  /* --- render --- */
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
        {/* ---- Toolbar ---- */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Contractor Store Issues</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Material issue and debit note tracking</span>
          </div>
          <button
            onClick={openCreateModal}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
          >
            + New Issue
          </button>
        </div>

        {/* ---- Filter bar ---- */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3">
          {['ALL', 'DRAFT', 'CONFIRMED', 'RETURNED'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 border ${
                statusFilter === s
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* ---- KPI strip ---- */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-slate-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Issues</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.total}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-yellow-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Draft</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.draft}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Confirmed</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{kpis.confirmed}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Value</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(kpis.totalValue)}</div>
          </div>
        </div>

        {/* ---- Table ---- */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs min-w-[900px]">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Issue #</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Contractor</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Items</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Subtotal</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Charge %</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Charge Amt</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Total</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">
                    No issues found
                  </td>
                </tr>
              ) : (
                data.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''}`}
                    onClick={() => openDetail(row.id)}
                  >
                    <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">SI-{row.issueNo}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{fmtDate(row.issueDate)}</td>
                    <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">{row.contractor?.name ?? '--'}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                      {row.linesCount ?? row.lines?.length ?? 0}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                      {fmtCurrency(row.subtotal)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                      {row.chargePercent}%
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                      {fmtCurrency(row.chargeAmount)}
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium border-r border-slate-100">
                      {fmtCurrency(row.totalAmount)}
                    </td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColor[row.status] ?? statusColor.DRAFT}`}>
                        {row.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openDetail(row.id);
                        }}
                        className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50"
                      >
                        View
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ================================================================ */}
      {/*  CREATE / EDIT MODAL                                              */}
      {/* ================================================================ */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto pt-10 pb-10">
          <div className="bg-white shadow-2xl w-full max-w-3xl">
            {/* modal header */}
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">
                {editId ? 'Edit Store Issue' : 'New Store Issue'}
              </span>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white text-sm">
                X
              </button>
            </div>

            {/* modal body */}
            <div className="p-4 space-y-4">
              {/* header fields */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">
                    Contractor
                  </label>
                  <select
                    value={formContractorId}
                    onChange={(e) => setFormContractorId(e.target.value)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option value="">-- Select --</option>
                    {contractors.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">
                    Charge %
                  </label>
                  <input
                    type="number"
                    value={formChargePercent}
                    onChange={(e) => setFormChargePercent(parseFloat(e.target.value) || 0)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">
                    Purpose
                  </label>
                  <input
                    type="text"
                    value={formPurpose}
                    onChange={(e) => setFormPurpose(e.target.value)}
                    placeholder="e.g. Maintenance work"
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              {/* lines table */}
              <div className="border border-slate-300 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-8">#</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Description</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Qty</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Unit</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Rate</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-28">Amount</th>
                      <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-12"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formLines.map((line, idx) => (
                      <tr key={idx} className={`border-b border-slate-100 ${idx % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-3 py-1 text-slate-400 border-r border-slate-100">{idx + 1}</td>
                        <td className="px-1 py-1 border-r border-slate-100">
                          <input
                            type="text"
                            value={line.description}
                            onChange={(e) => updateLine(idx, 'description', e.target.value)}
                            placeholder="Item description"
                            className="w-full border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>
                        <td className="px-1 py-1 border-r border-slate-100">
                          <input
                            type="number"
                            value={line.quantity}
                            onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)}
                            className="w-full border border-slate-300 px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>
                        <td className="px-1 py-1 border-r border-slate-100">
                          <input
                            type="text"
                            value={line.unit}
                            onChange={(e) => updateLine(idx, 'unit', e.target.value)}
                            className="w-full border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>
                        <td className="px-1 py-1 border-r border-slate-100">
                          <input
                            type="number"
                            value={line.rate}
                            onChange={(e) => updateLine(idx, 'rate', parseFloat(e.target.value) || 0)}
                            className="w-full border border-slate-300 px-2 py-1 text-xs text-right focus:outline-none focus:ring-1 focus:ring-slate-400"
                          />
                        </td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">
                          {fmtCurrency(line.quantity * line.rate)}
                        </td>
                        <td className="px-1 py-1 text-center">
                          <button
                            onClick={() => removeLine(idx)}
                            className="text-red-500 hover:text-red-700 text-[10px] font-bold"
                          >
                            DEL
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-200">
                  <button
                    onClick={() => setFormLines((prev) => [...prev, emptyLine()])}
                    className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                  >
                    + Add Line
                  </button>
                </div>
              </div>

              {/* totals */}
              <div className="flex justify-end">
                <div className="w-64 border border-slate-300">
                  <div className="flex justify-between px-3 py-1.5 text-xs border-b border-slate-100">
                    <span className="text-slate-500 font-medium">Subtotal</span>
                    <span className="font-mono tabular-nums text-slate-800">{fmtCurrency(lineSubtotal)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1.5 text-xs border-b border-slate-100">
                    <span className="text-slate-500 font-medium">Charge ({formChargePercent}%)</span>
                    <span className="font-mono tabular-nums text-slate-800">{fmtCurrency(lineChargeAmt)}</span>
                  </div>
                  <div className="flex justify-between px-3 py-1.5 text-xs bg-slate-800 text-white font-bold">
                    <span>Total</span>
                    <span className="font-mono tabular-nums">{fmtCurrency(lineTotal)}</span>
                  </div>
                </div>
              </div>

              {/* form actions */}
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setShowForm(false)}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !formContractorId}
                  className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : editId ? 'Update Draft' : 'Save as Draft'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ================================================================ */}
      {/*  DETAIL MODAL                                                     */}
      {/* ================================================================ */}
      {showDetail && detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto pt-10 pb-10">
          <div className="bg-white shadow-2xl w-full max-w-3xl">
            {/* modal header */}
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-widest">
                  Store Issue SI-{detail.issueNo}
                </span>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColor[detail.status] ?? statusColor.DRAFT}`}>
                  {detail.status}
                </span>
              </div>
              <button onClick={() => setShowDetail(false)} className="text-slate-400 hover:text-white text-sm">
                X
              </button>
            </div>

            {/* detail body */}
            <div className="p-4 space-y-4">
              {/* header info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Issue Date</div>
                  <div className="text-xs text-slate-800 mt-0.5">{fmtDate(detail.issueDate)}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Contractor</div>
                  <div className="text-xs text-slate-800 mt-0.5 font-medium">{detail.contractor?.name ?? '--'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Purpose</div>
                  <div className="text-xs text-slate-800 mt-0.5">{detail.purpose || '--'}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Status</div>
                  <div className="text-xs text-slate-800 mt-0.5">{detail.status}</div>
                </div>
              </div>

              {/* charge breakdown */}
              <div className="border border-slate-300">
                <div className="bg-slate-200 border-b border-slate-300 px-3 py-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Debit Note Summary</span>
                </div>
                <div className="grid grid-cols-4 divide-x divide-slate-200">
                  <div className="px-3 py-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Subtotal</div>
                    <div className="text-sm font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{fmtCurrency(detail.subtotal)}</div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Charge %</div>
                    <div className="text-sm font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{detail.chargePercent}%</div>
                  </div>
                  <div className="px-3 py-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Charge Amount</div>
                    <div className="text-sm font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{fmtCurrency(detail.chargeAmount)}</div>
                  </div>
                  <div className="px-3 py-2 bg-slate-50">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total</div>
                    <div className="text-sm font-bold text-blue-700 mt-0.5 font-mono tabular-nums">{fmtCurrency(detail.totalAmount)}</div>
                  </div>
                </div>
              </div>

              {/* lines table */}
              <div className="border border-slate-300 overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-8">#</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Description</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Qty</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Unit</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Returned</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.lines.map((line, idx) => (
                      <tr key={line.id} className={`border-b border-slate-100 ${idx % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-3 py-1.5 text-slate-400 border-r border-slate-100">{idx + 1}</td>
                        <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">{line.description}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{line.quantity}</td>
                        <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{line.unit}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(line.rate)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium border-r border-slate-100">{fmtCurrency(line.amount)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600">{line.returnedQty}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-800 text-white font-semibold">
                      <td colSpan={5} className="px-3 py-1.5 text-right text-[10px] uppercase tracking-widest border-r border-slate-700">Subtotal</td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-700">{fmtCurrency(detail.subtotal)}</td>
                      <td className="px-3 py-1.5"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>

              {/* timestamps */}
              {(detail.confirmedAt || detail.returnedAt) && (
                <div className="flex gap-6 text-[10px] text-slate-400 uppercase tracking-widest">
                  {detail.confirmedAt && <span>Confirmed: {fmtDate(detail.confirmedAt)}</span>}
                  {detail.returnedAt && <span>Returned: {fmtDate(detail.returnedAt)}</span>}
                </div>
              )}

              {detail.returnRemarks && (
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Return Remarks</div>
                  <div className="text-xs text-slate-700 mt-0.5">{detail.returnRemarks}</div>
                </div>
              )}

              {/* return remarks input (for confirmed issues) */}
              {detail.status === 'CONFIRMED' && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">
                    Return Remarks (optional)
                  </label>
                  <input
                    type="text"
                    value={returnRemarks}
                    onChange={(e) => setReturnRemarks(e.target.value)}
                    placeholder="Remarks for return..."
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              )}

              {/* actions */}
              <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
                {detail.status === 'DRAFT' && (
                  <>
                    <button
                      onClick={deleteIssue}
                      disabled={actionLoading}
                      className="px-3 py-1 bg-white border border-red-300 text-red-600 text-[11px] font-medium hover:bg-red-50 disabled:opacity-50"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => openEditModal(detail)}
                      disabled={actionLoading}
                      className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50"
                    >
                      Edit
                    </button>
                    <button
                      onClick={confirmIssue}
                      disabled={actionLoading}
                      className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                    >
                      {actionLoading ? 'Processing...' : 'Confirm Issue'}
                    </button>
                  </>
                )}
                {detail.status === 'CONFIRMED' && (
                  <button
                    onClick={markReturned}
                    disabled={actionLoading}
                    className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-50"
                  >
                    {actionLoading ? 'Processing...' : 'Mark Returned'}
                  </button>
                )}
                <button
                  onClick={() => setShowDetail(false)}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
