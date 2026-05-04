import React, { useState, useEffect, useCallback, useMemo } from 'react';
import api from '../../services/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type SupplyType = 'INTRA_STATE' | 'INTER_STATE';

interface WorkOrderLine {
  id: string;
  lineNo: number;
  description: string;
  hsnSac?: string | null;
  quantity: number;
  unit: string;
  rate: number;
  amount: number;
  discountPercent: number;
  discountAmount: number;
  taxableAmount: number;
  gstPercent: number;
  cgstPercent: number;
  cgstAmount: number;
  sgstPercent: number;
  sgstAmount: number;
  igstPercent: number;
  igstAmount: number;
  totalGst: number;
  lineTotal: number;
  completedQty: number;
  remarks?: string | null;
}

interface ProgressEntry {
  id: string;
  reportedAt: string;
  percent: number;
  workDone: string;
  remarks?: string | null;
}

interface LinkedBill {
  id: string;
  billNo: number;
  billDate: string;
  subtotal: number;
  totalAmount: number;
  netPayable: number;
  paidAmount: number;
  balanceAmount: number;
  status: string;
  vendorBillNo?: string | null;
}

interface WorkOrder {
  id: string;
  woNo: number;
  title: string;
  description?: string | null;
  contractorId: string;
  contractor: { id: string; name: string; contractorCode?: string; gstin?: string | null; tdsSection?: string; tdsPercent?: number };
  startDate?: string | null;
  endDate?: string | null;
  siteLocation?: string | null;
  supplyType: SupplyType;
  placeOfSupply?: string | null;
  subtotal: number;
  discountAmount: number;
  taxableAmount: number;
  totalCgst: number;
  totalSgst: number;
  totalIgst: number;
  totalGst: number;
  grandTotal: number;
  retentionPercent: number;
  retentionAmount: number;
  tdsSection: string;
  tdsPercent: number;
  tdsAmount: number;
  billedAmount: number;
  paidAmount: number;
  balanceAmount: number;
  progressPercent: number;
  status: 'DRAFT' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CLOSED' | 'CANCELLED';
  paymentTerms?: string | null;
  creditDays: number;
  remarks?: string | null;
  division?: string | null;
  createdAt: string;
  lines?: WorkOrderLine[];
  progress?: ProgressEntry[];
  bills?: LinkedBill[];
  _count?: { lines: number; bills: number; progress: number };
}

interface ContractorOption {
  id: string;
  name: string;
  contractorCode?: string;
  tdsSection?: string;
  tdsPercent?: number;
  gstin?: string | null;
}

interface Stats {
  total: number;
  draft: number;
  approved: number;
  inProgress: number;
  completed: number;
  closed: number;
  totalValue: number;
  totalBilled: number;
  totalUnbilled: number;
}

interface DraftLine {
  description: string;
  hsnSac: string;
  quantity: number;
  unit: string;
  rate: number;
  discountPercent: number;
  gstPercent: number;
  remarks: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const fmtCurrency = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  return v === 0 ? '--' : '₹' + v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const fmtDate = (iso?: string | null) => {
  if (!iso) return '--';
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};

const r2 = (n: number) => Math.round(n * 100) / 100;

const statusColor: Record<string, string> = {
  DRAFT: 'border-slate-400 bg-slate-50 text-slate-600',
  APPROVED: 'border-indigo-500 bg-indigo-50 text-indigo-700',
  IN_PROGRESS: 'border-blue-500 bg-blue-50 text-blue-700',
  COMPLETED: 'border-emerald-500 bg-emerald-50 text-emerald-700',
  CLOSED: 'border-green-600 bg-green-50 text-green-700',
  CANCELLED: 'border-red-500 bg-red-50 text-red-700',
};

const emptyLine = (): DraftLine => ({
  description: '',
  hsnSac: '',
  quantity: 1,
  unit: 'NOS',
  rate: 0,
  discountPercent: 0,
  gstPercent: 18,
  remarks: '',
});

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function WorkOrders() {
  const [data, setData] = useState<WorkOrder[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, draft: 0, approved: 0, inProgress: 0, completed: 0, closed: 0, totalValue: 0, totalBilled: 0, totalUnbilled: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [contractors, setContractors] = useState<ContractorOption[]>([]);

  // create/edit modal
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formContractorId, setFormContractorId] = useState('');
  const [formTitle, setFormTitle] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formStart, setFormStart] = useState('');
  const [formEnd, setFormEnd] = useState('');
  const [formSite, setFormSite] = useState('');
  const [formSupplyType, setFormSupplyType] = useState<SupplyType>('INTRA_STATE');
  const [formPlaceOfSupply, setFormPlaceOfSupply] = useState('');
  const [formRetention, setFormRetention] = useState(0);
  const [formCreditDays, setFormCreditDays] = useState(30);
  const [formPaymentTerms, setFormPaymentTerms] = useState('');
  const [formRemarks, setFormRemarks] = useState('');
  const [formLines, setFormLines] = useState<DraftLine[]>([emptyLine()]);
  const [saving, setSaving] = useState(false);

  // detail modal
  const [detail, setDetail] = useState<WorkOrder | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  // progress sub-form
  const [progressPercent, setProgressPercent] = useState(0);
  const [progressNote, setProgressNote] = useState('');

  // bill sub-form
  const [billDescription, setBillDescription] = useState('');
  const [billAmount, setBillAmount] = useState(0);
  const [billGstPercent, setBillGstPercent] = useState(18);
  const [billVendorRef, setBillVendorRef] = useState('');

  /* ----- fetchers ----- */

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = {};
      if (statusFilter !== 'ALL') params.status = statusFilter;
      const res = await api.get<{ orders: WorkOrder[]; stats: Stats }>('/work-orders', { params });
      setData(res.data.orders ?? []);
      if (res.data.stats) setStats(res.data.stats);
    } catch (err) {
      console.error('Failed to fetch work orders:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  const fetchContractors = useCallback(async () => {
    try {
      const res = await api.get('/contractors', { params: { active: 'true' } });
      const list = Array.isArray(res.data)
        ? res.data
        : (res.data as { contractors?: ContractorOption[]; items?: ContractorOption[] }).contractors ??
          (res.data as { items?: ContractorOption[] }).items ?? [];
      setContractors(list);
    } catch (err) {
      console.error('Failed to fetch contractors:', err);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchContractors(); }, [fetchContractors]);

  /* ----- live totals for form ----- */

  const formTotals = useMemo(() => {
    const lines = formLines.map((l) => {
      const amount = r2(l.quantity * l.rate);
      const discountAmount = r2(amount * (l.discountPercent / 100));
      const taxableAmount = r2(amount - discountAmount);
      const totalGst = r2(taxableAmount * (l.gstPercent / 100));
      return { amount, discountAmount, taxableAmount, totalGst, lineTotal: r2(taxableAmount + totalGst) };
    });
    const subtotal = r2(lines.reduce((s, l) => s + l.amount, 0));
    const discountAmount = r2(lines.reduce((s, l) => s + l.discountAmount, 0));
    const taxableAmount = r2(lines.reduce((s, l) => s + l.taxableAmount, 0));
    const totalGst = r2(lines.reduce((s, l) => s + l.totalGst, 0));
    const totalCgst = formSupplyType === 'INTRA_STATE' ? r2(totalGst / 2) : 0;
    const totalSgst = formSupplyType === 'INTRA_STATE' ? r2(totalGst - totalCgst) : 0;
    const totalIgst = formSupplyType === 'INTER_STATE' ? totalGst : 0;
    const grandTotal = r2(taxableAmount + totalGst);
    const retentionAmount = r2(grandTotal * (formRetention / 100));

    const ctr = contractors.find((c) => c.id === formContractorId);
    const tdsPercent = ctr?.tdsPercent ?? 0;
    const tdsAmount = r2(taxableAmount * (tdsPercent / 100));
    return {
      lines, subtotal, discountAmount, taxableAmount, totalCgst, totalSgst, totalIgst, totalGst,
      grandTotal, retentionAmount, tdsPercent, tdsAmount,
      tdsSection: ctr?.tdsSection ?? '194C',
    };
  }, [formLines, formSupplyType, formRetention, formContractorId, contractors]);

  /* ----- form actions ----- */

  const updateLine = (idx: number, field: keyof DraftLine, value: string | number) => {
    setFormLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const removeLine = (idx: number) => {
    setFormLines((prev) => (prev.length === 1 ? [emptyLine()] : prev.filter((_, i) => i !== idx)));
  };

  const resetForm = () => {
    setEditId(null);
    setFormContractorId('');
    setFormTitle('');
    setFormDesc('');
    setFormStart('');
    setFormEnd('');
    setFormSite('');
    setFormSupplyType('INTRA_STATE');
    setFormPlaceOfSupply('');
    setFormRetention(0);
    setFormCreditDays(30);
    setFormPaymentTerms('');
    setFormRemarks('');
    setFormLines([emptyLine()]);
  };

  const openCreate = () => {
    resetForm();
    setShowForm(true);
  };

  const openEdit = (wo: WorkOrder) => {
    setEditId(wo.id);
    setFormContractorId(wo.contractorId);
    setFormTitle(wo.title);
    setFormDesc(wo.description ?? '');
    setFormStart(wo.startDate ? wo.startDate.slice(0, 10) : '');
    setFormEnd(wo.endDate ? wo.endDate.slice(0, 10) : '');
    setFormSite(wo.siteLocation ?? '');
    setFormSupplyType(wo.supplyType);
    setFormPlaceOfSupply(wo.placeOfSupply ?? '');
    setFormRetention(wo.retentionPercent);
    setFormCreditDays(wo.creditDays);
    setFormPaymentTerms(wo.paymentTerms ?? '');
    setFormRemarks(wo.remarks ?? '');
    setFormLines(
      (wo.lines ?? []).map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac ?? '',
        quantity: l.quantity,
        unit: l.unit,
        rate: l.rate,
        discountPercent: l.discountPercent,
        gstPercent: l.gstPercent,
        remarks: l.remarks ?? '',
      })) || [emptyLine()],
    );
    setShowDetail(false);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formContractorId || !formTitle.trim()) return;
    const validLines = formLines.filter((l) => l.description.trim() && l.quantity > 0 && l.rate > 0);
    if (validLines.length === 0) return;
    setSaving(true);
    try {
      const payload = {
        contractorId: formContractorId,
        title: formTitle.trim(),
        description: formDesc || null,
        startDate: formStart || null,
        endDate: formEnd || null,
        siteLocation: formSite || null,
        supplyType: formSupplyType,
        placeOfSupply: formPlaceOfSupply || null,
        retentionPercent: formRetention,
        paymentTerms: formPaymentTerms || null,
        creditDays: formCreditDays,
        remarks: formRemarks || null,
        lines: validLines.map((l) => ({
          description: l.description,
          hsnSac: l.hsnSac || null,
          quantity: l.quantity,
          unit: l.unit || 'NOS',
          rate: l.rate,
          discountPercent: l.discountPercent,
          gstPercent: l.gstPercent,
          remarks: l.remarks || null,
        })),
      };
      if (editId) {
        await api.put(`/work-orders/${editId}`, payload);
      } else {
        await api.post('/work-orders', payload);
      }
      setShowForm(false);
      fetchData();
    } catch (err) {
      console.error('Save failed:', err);
      alert('Save failed — see console');
    } finally {
      setSaving(false);
    }
  };

  /* ----- detail actions ----- */

  const openDetail = async (id: string) => {
    try {
      const res = await api.get<WorkOrder>(`/work-orders/${id}`);
      setDetail(res.data);
      setProgressPercent(res.data.progressPercent || 0);
      setProgressNote('');
      setBillDescription(`Work bill — ${res.data.title}`);
      setBillAmount(Math.max(0, res.data.balanceAmount));
      setBillGstPercent(res.data.lines?.[0]?.gstPercent ?? 18);
      setBillVendorRef('');
      setShowDetail(true);
    } catch (err) {
      console.error('Failed to load detail:', err);
    }
  };

  const refreshDetail = async () => {
    if (!detail) return;
    const res = await api.get<WorkOrder>(`/work-orders/${detail.id}`);
    setDetail(res.data);
    fetchData();
  };

  const callAction = async (path: string, body?: Record<string, unknown>) => {
    if (!detail) return;
    setActionLoading(true);
    try {
      await api.post(`/work-orders/${detail.id}/${path}`, body ?? {});
      await refreshDetail();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      alert(e?.response?.data?.error || 'Action failed');
      console.error(`${path} failed:`, err);
    } finally {
      setActionLoading(false);
    }
  };

  const deleteWO = async () => {
    if (!detail) return;
    if (!window.confirm('Delete this draft work order?')) return;
    setActionLoading(true);
    try {
      await api.delete(`/work-orders/${detail.id}`);
      setShowDetail(false);
      fetchData();
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      setActionLoading(false);
    }
  };

  const submitProgress = async () => {
    if (!detail || !progressNote.trim()) return;
    setActionLoading(true);
    try {
      await api.post(`/work-orders/${detail.id}/progress`, {
        percent: progressPercent,
        workDone: progressNote.trim(),
      });
      setProgressNote('');
      await refreshDetail();
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      alert(e?.response?.data?.error || 'Could not save progress');
    } finally {
      setActionLoading(false);
    }
  };

  const createBillFromWO = async () => {
    if (!detail) return;
    if (billAmount <= 0) {
      alert('Bill amount must be greater than zero');
      return;
    }
    setActionLoading(true);
    try {
      const cgstPercent = detail.supplyType === 'INTRA_STATE' ? billGstPercent / 2 : 0;
      const sgstPercent = detail.supplyType === 'INTRA_STATE' ? billGstPercent / 2 : 0;
      const igstPercent = detail.supplyType === 'INTER_STATE' ? billGstPercent : 0;

      await api.post('/contractor-bills', {
        contractorId: detail.contractorId,
        workOrderId: detail.id,
        billPath: 'CREATED',
        description: billDescription || `Work bill — ${detail.title}`,
        vendorBillNo: billVendorRef || null,
        cgstPercent,
        sgstPercent,
        igstPercent,
        lines: [
          {
            description: billDescription || detail.title,
            quantity: 1,
            unit: 'LUMP',
            rate: billAmount,
          },
        ],
      });
      await refreshDetail();
      alert('Bill created (DRAFT). Open Contractor Bills to confirm + record payment.');
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string } } };
      alert(e?.response?.data?.error || 'Bill creation failed');
    } finally {
      setActionLoading(false);
    }
  };

  /* ----- render ----- */

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
            <h1 className="text-sm font-bold tracking-wide uppercase">Contractor Work Orders</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">PO-style scope authorisation, GST + TDS, progress &amp; billing</span>
          </div>
          <button
            onClick={openCreate}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
          >
            + New Work Order
          </button>
        </div>

        {/* Filters */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-2 flex-wrap">
          {['ALL', 'DRAFT', 'APPROVED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'CANCELLED'].map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`text-[11px] font-bold uppercase tracking-widest px-2 py-0.5 border ${
                statusFilter === s
                  ? 'border-blue-600 bg-blue-600 text-white'
                  : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              {s.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-slate-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total WOs</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.total}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-yellow-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Draft / Approved</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.draft + stats.approved}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">In Progress</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.inProgress}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-emerald-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Order Value</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(stats.totalValue)}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-orange-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Unbilled Scope</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmtCurrency(stats.totalUnbilled)}</div>
          </div>
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs min-w-[1100px]">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">WO #</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Contractor</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Title</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Taxable</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">GST</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Total</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Billed</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Balance</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Progress</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">
                    No work orders found
                  </td>
                </tr>
              ) : (
                data.map((row, i) => (
                  <tr
                    key={row.id}
                    className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''}`}
                    onClick={() => openDetail(row.id)}
                  >
                    <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">WO-{row.woNo}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{fmtDate(row.createdAt)}</td>
                    <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100">{row.contractor?.name ?? '--'}</td>
                    <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 max-w-[260px] truncate">{row.title}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(row.taxableAmount)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(row.totalGst)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium border-r border-slate-100">{fmtCurrency(row.grandTotal)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(row.billedAmount)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(row.balanceAmount)}</td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                      <div className="flex items-center gap-1">
                        <div className="flex-1 bg-slate-200 h-1.5 overflow-hidden">
                          <div className="bg-blue-500 h-1.5" style={{ width: `${Math.min(100, row.progressPercent)}%` }} />
                        </div>
                        <span className="text-[10px] font-mono tabular-nums text-slate-500">{Math.round(row.progressPercent)}%</span>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColor[row.status] ?? statusColor.DRAFT}`}>
                        {row.status.replace('_', ' ')}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ===================== CREATE/EDIT MODAL ===================== */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto pt-6 pb-10">
          <div className="bg-white shadow-2xl w-full max-w-5xl">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">
                {editId ? 'Edit Work Order' : 'New Work Order'}
              </span>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-white text-sm">X</button>
            </div>

            <div className="p-4 space-y-4">
              {/* Header fields row 1 */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Contractor *</label>
                  <select
                    value={formContractorId}
                    onChange={(e) => setFormContractorId(e.target.value)}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  >
                    <option value="">-- Select --</option>
                    {contractors.map((c) => (
                      <option key={c.id} value={c.id}>{c.contractorCode ? `${c.contractorCode} — ` : ''}{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Work Title *</label>
                  <input
                    type="text"
                    value={formTitle}
                    onChange={(e) => setFormTitle(e.target.value)}
                    placeholder="e.g. RCC roofing — boiler shed bay 4"
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Scope of Work</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  rows={2}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                  placeholder="Detailed description of the work to be performed"
                />
              </div>

              <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Start Date</label>
                  <input type="date" value={formStart} onChange={(e) => setFormStart(e.target.value)} className="w-full border border-slate-300 px-2 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">End Date</label>
                  <input type="date" value={formEnd} onChange={(e) => setFormEnd(e.target.value)} className="w-full border border-slate-300 px-2 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Site</label>
                  <input type="text" value={formSite} onChange={(e) => setFormSite(e.target.value)} placeholder="e.g. Plant — bay 4" className="w-full border border-slate-300 px-2 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Supply Type</label>
                  <select value={formSupplyType} onChange={(e) => setFormSupplyType(e.target.value as SupplyType)} className="w-full border border-slate-300 px-2 py-1.5 text-xs">
                    <option value="INTRA_STATE">Intra-state (CGST + SGST)</option>
                    <option value="INTER_STATE">Inter-state (IGST)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Place of Supply</label>
                  <input type="text" value={formPlaceOfSupply} onChange={(e) => setFormPlaceOfSupply(e.target.value)} placeholder="MP" className="w-full border border-slate-300 px-2 py-1.5 text-xs" />
                </div>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Retention %</label>
                  <input type="number" value={formRetention} onChange={(e) => setFormRetention(parseFloat(e.target.value) || 0)} className="w-full border border-slate-300 px-2 py-1.5 text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Credit Days</label>
                  <input type="number" value={formCreditDays} onChange={(e) => setFormCreditDays(parseInt(e.target.value) || 0)} className="w-full border border-slate-300 px-2 py-1.5 text-xs" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Payment Terms</label>
                  <input type="text" value={formPaymentTerms} onChange={(e) => setFormPaymentTerms(e.target.value)} placeholder="30% advance, 60% on completion, 10% retention release after 90 days" className="w-full border border-slate-300 px-2 py-1.5 text-xs" />
                </div>
              </div>

              {/* Lines table */}
              <div className="border border-slate-300 overflow-x-auto">
                <table className="w-full text-xs min-w-[900px]">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-8">#</th>
                      <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Description</th>
                      <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">HSN/SAC</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">Qty</th>
                      <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">Unit</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Rate</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">Disc%</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">GST%</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-28">Line Total</th>
                      <th className="text-center px-2 py-2 font-semibold text-[10px] uppercase tracking-widest w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {formLines.map((line, idx) => {
                      const tot = formTotals.lines[idx];
                      return (
                        <tr key={idx} className={`border-b border-slate-100 ${idx % 2 ? 'bg-slate-50/70' : ''}`}>
                          <td className="px-2 py-1 text-slate-400 border-r border-slate-100">{idx + 1}</td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input type="text" value={line.description} onChange={(e) => updateLine(idx, 'description', e.target.value)} placeholder="Scope item" className="w-full border border-slate-300 px-2 py-1 text-xs" />
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input type="text" value={line.hsnSac} onChange={(e) => updateLine(idx, 'hsnSac', e.target.value)} placeholder="9954" className="w-full border border-slate-300 px-2 py-1 text-xs" />
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input type="number" value={line.quantity} onChange={(e) => updateLine(idx, 'quantity', parseFloat(e.target.value) || 0)} className="w-full border border-slate-300 px-2 py-1 text-xs text-right" />
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input type="text" value={line.unit} onChange={(e) => updateLine(idx, 'unit', e.target.value)} className="w-full border border-slate-300 px-2 py-1 text-xs" />
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input type="number" value={line.rate} onChange={(e) => updateLine(idx, 'rate', parseFloat(e.target.value) || 0)} className="w-full border border-slate-300 px-2 py-1 text-xs text-right" />
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input type="number" value={line.discountPercent} onChange={(e) => updateLine(idx, 'discountPercent', parseFloat(e.target.value) || 0)} className="w-full border border-slate-300 px-2 py-1 text-xs text-right" />
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input type="number" value={line.gstPercent} onChange={(e) => updateLine(idx, 'gstPercent', parseFloat(e.target.value) || 0)} className="w-full border border-slate-300 px-2 py-1 text-xs text-right" />
                          </td>
                          <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(tot?.lineTotal ?? 0)}</td>
                          <td className="px-1 py-1 text-center">
                            <button onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-700 text-[10px] font-bold">DEL</button>
                          </td>
                        </tr>
                      );
                    })}
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

              {/* Totals + remarks */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Remarks</label>
                  <textarea value={formRemarks} onChange={(e) => setFormRemarks(e.target.value)} rows={5} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" />
                </div>
                <div className="border border-slate-300">
                  <div className="flex justify-between px-3 py-1.5 text-xs border-b border-slate-100"><span className="text-slate-500">Subtotal</span><span className="font-mono tabular-nums text-slate-800">{fmtCurrency(formTotals.subtotal)}</span></div>
                  <div className="flex justify-between px-3 py-1.5 text-xs border-b border-slate-100"><span className="text-slate-500">Discount</span><span className="font-mono tabular-nums text-slate-800">- {fmtCurrency(formTotals.discountAmount)}</span></div>
                  <div className="flex justify-between px-3 py-1.5 text-xs border-b border-slate-100"><span className="text-slate-500">Taxable</span><span className="font-mono tabular-nums text-slate-800">{fmtCurrency(formTotals.taxableAmount)}</span></div>
                  {formSupplyType === 'INTRA_STATE' ? (
                    <>
                      <div className="flex justify-between px-3 py-1.5 text-xs border-b border-slate-100"><span className="text-slate-500">CGST</span><span className="font-mono tabular-nums text-slate-800">{fmtCurrency(formTotals.totalCgst)}</span></div>
                      <div className="flex justify-between px-3 py-1.5 text-xs border-b border-slate-100"><span className="text-slate-500">SGST</span><span className="font-mono tabular-nums text-slate-800">{fmtCurrency(formTotals.totalSgst)}</span></div>
                    </>
                  ) : (
                    <div className="flex justify-between px-3 py-1.5 text-xs border-b border-slate-100"><span className="text-slate-500">IGST</span><span className="font-mono tabular-nums text-slate-800">{fmtCurrency(formTotals.totalIgst)}</span></div>
                  )}
                  <div className="flex justify-between px-3 py-1.5 text-xs border-b border-slate-100 bg-slate-50"><span className="text-slate-700 font-semibold">Grand Total</span><span className="font-mono tabular-nums text-slate-900 font-bold">{fmtCurrency(formTotals.grandTotal)}</span></div>
                  <div className="flex justify-between px-3 py-1.5 text-xs border-b border-slate-100"><span className="text-slate-500">Retention ({formRetention}%)</span><span className="font-mono tabular-nums text-orange-700">- {fmtCurrency(formTotals.retentionAmount)}</span></div>
                  <div className="flex justify-between px-3 py-1.5 text-xs"><span className="text-slate-500">TDS {formTotals.tdsSection} ({formTotals.tdsPercent}%)</span><span className="font-mono tabular-nums text-orange-700">- {fmtCurrency(formTotals.tdsAmount)}</span></div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowForm(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                <button onClick={handleSave} disabled={saving || !formContractorId || !formTitle.trim()} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                  {saving ? 'Saving...' : editId ? 'Update Draft' : 'Save as Draft'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================== DETAIL MODAL ===================== */}
      {showDetail && detail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 overflow-y-auto pt-6 pb-10">
          <div className="bg-white shadow-2xl w-full max-w-5xl">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-widest">Work Order WO-{detail.woNo}</span>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColor[detail.status] ?? statusColor.DRAFT}`}>
                  {detail.status.replace('_', ' ')}
                </span>
              </div>
              <button onClick={() => setShowDetail(false)} className="text-slate-400 hover:text-white text-sm">X</button>
            </div>

            <div className="p-4 space-y-4">
              {/* Title + meta */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="md:col-span-2">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Title</div>
                  <div className="text-sm text-slate-800 font-semibold mt-0.5">{detail.title}</div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Contractor</div>
                  <div className="text-xs text-slate-800 mt-0.5 font-medium">
                    {detail.contractor.contractorCode ? `${detail.contractor.contractorCode} — ` : ''}{detail.contractor.name}
                  </div>
                  <div className="text-[10px] text-slate-400 mt-0.5">
                    GSTIN: {detail.contractor.gstin || '—'} • TDS {detail.tdsSection} {detail.tdsPercent}%
                  </div>
                </div>
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Site / Period</div>
                  <div className="text-xs text-slate-800 mt-0.5">{detail.siteLocation || '—'}</div>
                  <div className="text-[10px] text-slate-400 mt-0.5">{fmtDate(detail.startDate)} → {fmtDate(detail.endDate)}</div>
                </div>
              </div>

              {detail.description && (
                <div>
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Scope</div>
                  <div className="text-xs text-slate-700 mt-0.5 whitespace-pre-wrap">{detail.description}</div>
                </div>
              )}

              {/* Money strip */}
              <div className="border border-slate-300">
                <div className="bg-slate-200 border-b border-slate-300 px-3 py-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Order &amp; Settlement</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-6 divide-x divide-slate-200">
                  <div className="px-3 py-2"><div className="text-[10px] font-bold text-slate-400 uppercase">Taxable</div><div className="text-sm font-bold text-slate-800 font-mono tabular-nums mt-0.5">{fmtCurrency(detail.taxableAmount)}</div></div>
                  <div className="px-3 py-2"><div className="text-[10px] font-bold text-slate-400 uppercase">GST</div><div className="text-sm font-bold text-slate-800 font-mono tabular-nums mt-0.5">{fmtCurrency(detail.totalGst)}</div></div>
                  <div className="px-3 py-2 bg-slate-50"><div className="text-[10px] font-bold text-slate-400 uppercase">Grand Total</div><div className="text-sm font-bold text-blue-700 font-mono tabular-nums mt-0.5">{fmtCurrency(detail.grandTotal)}</div></div>
                  <div className="px-3 py-2"><div className="text-[10px] font-bold text-slate-400 uppercase">Billed</div><div className="text-sm font-bold text-slate-800 font-mono tabular-nums mt-0.5">{fmtCurrency(detail.billedAmount)}</div></div>
                  <div className="px-3 py-2"><div className="text-[10px] font-bold text-slate-400 uppercase">Paid</div><div className="text-sm font-bold text-emerald-700 font-mono tabular-nums mt-0.5">{fmtCurrency(detail.paidAmount)}</div></div>
                  <div className="px-3 py-2 bg-slate-50"><div className="text-[10px] font-bold text-slate-400 uppercase">Balance</div><div className="text-sm font-bold text-orange-700 font-mono tabular-nums mt-0.5">{fmtCurrency(detail.balanceAmount)}</div></div>
                </div>
              </div>

              {/* Lines */}
              <div className="border border-slate-300 overflow-x-auto">
                <table className="w-full text-xs min-w-[900px]">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-8">#</th>
                      <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Description</th>
                      <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">HSN/SAC</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Qty</th>
                      <th className="text-left px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Unit</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Taxable</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">GST%</th>
                      <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest">Line Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.lines ?? []).map((line, idx) => (
                      <tr key={line.id} className={`border-b border-slate-100 ${idx % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-2 py-1.5 text-slate-400 border-r border-slate-100">{line.lineNo}</td>
                        <td className="px-2 py-1.5 text-slate-800 border-r border-slate-100">{line.description}</td>
                        <td className="px-2 py-1.5 text-slate-600 border-r border-slate-100 font-mono">{line.hsnSac || '—'}</td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{line.quantity}</td>
                        <td className="px-2 py-1.5 text-slate-600 border-r border-slate-100">{line.unit}</td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(line.rate)}</td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(line.taxableAmount)}</td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-600 border-r border-slate-100">{line.gstPercent}%</td>
                        <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium">{fmtCurrency(line.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Progress */}
              <div className="border border-slate-300">
                <div className="bg-slate-200 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Progress Log</span>
                  <span className="text-[10px] font-bold text-slate-700 font-mono tabular-nums">{Math.round(detail.progressPercent)}%</span>
                </div>
                <div className="px-3 py-2 max-h-44 overflow-y-auto">
                  {(detail.progress ?? []).length === 0 ? (
                    <div className="text-[11px] text-slate-400 italic">No progress reports yet.</div>
                  ) : (
                    <ul className="space-y-1.5">
                      {(detail.progress ?? []).map((p) => (
                        <li key={p.id} className="text-xs">
                          <span className="text-[10px] font-mono tabular-nums text-slate-400 mr-2">{fmtDate(p.reportedAt)}</span>
                          <span className="font-bold text-slate-700">{Math.round(p.percent)}%</span>
                          <span className="text-slate-700 ml-2">— {p.workDone}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {['APPROVED', 'IN_PROGRESS', 'COMPLETED'].includes(detail.status) && (
                  <div className="border-t border-slate-200 px-3 py-2 grid grid-cols-1 md:grid-cols-[120px_1fr_auto] gap-2 items-end">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Progress %</label>
                      <input type="number" min={0} max={100} value={progressPercent} onChange={(e) => setProgressPercent(parseFloat(e.target.value) || 0)} className="w-full border border-slate-300 px-2 py-1 text-xs" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Work Done</label>
                      <input type="text" value={progressNote} onChange={(e) => setProgressNote(e.target.value)} placeholder="e.g. RCC slab cured day 7" className="w-full border border-slate-300 px-2 py-1 text-xs" />
                    </div>
                    <button disabled={actionLoading || !progressNote.trim()} onClick={submitProgress} className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">Log Progress</button>
                  </div>
                )}
              </div>

              {/* Bills */}
              <div className="border border-slate-300">
                <div className="bg-slate-200 border-b border-slate-300 px-3 py-1.5">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Bills against this Work Order</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                      <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-widest font-semibold border-r border-slate-200">Bill #</th>
                      <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-widest font-semibold border-r border-slate-200">Date</th>
                      <th className="text-right px-2 py-1.5 text-[10px] uppercase tracking-widest font-semibold border-r border-slate-200">Subtotal</th>
                      <th className="text-right px-2 py-1.5 text-[10px] uppercase tracking-widest font-semibold border-r border-slate-200">Net Payable</th>
                      <th className="text-right px-2 py-1.5 text-[10px] uppercase tracking-widest font-semibold border-r border-slate-200">Paid</th>
                      <th className="text-right px-2 py-1.5 text-[10px] uppercase tracking-widest font-semibold border-r border-slate-200">Balance</th>
                      <th className="text-center px-2 py-1.5 text-[10px] uppercase tracking-widest font-semibold">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(detail.bills ?? []).length === 0 ? (
                      <tr><td colSpan={7} className="px-3 py-3 text-center text-[11px] text-slate-400 italic">No bills yet.</td></tr>
                    ) : (
                      (detail.bills ?? []).map((b) => (
                        <tr key={b.id} className="border-b border-slate-100">
                          <td className="px-2 py-1.5 text-slate-800 font-medium border-r border-slate-100">CB-{b.billNo}</td>
                          <td className="px-2 py-1.5 text-slate-600 border-r border-slate-100">{fmtDate(b.billDate)}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(b.subtotal)}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium border-r border-slate-100">{fmtCurrency(b.netPayable)}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-emerald-700 border-r border-slate-100">{fmtCurrency(b.paidAmount)}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-orange-700 border-r border-slate-100">{fmtCurrency(b.balanceAmount)}</td>
                          <td className="px-2 py-1.5 text-center text-[10px] font-bold uppercase">{b.status.replace('_', ' ')}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>

                {['IN_PROGRESS', 'COMPLETED'].includes(detail.status) && detail.balanceAmount > 0 && (
                  <div className="border-t border-slate-200 p-3 grid grid-cols-1 md:grid-cols-[1fr_120px_140px_120px_auto] gap-2 items-end">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Bill Description</label>
                      <input type="text" value={billDescription} onChange={(e) => setBillDescription(e.target.value)} className="w-full border border-slate-300 px-2 py-1 text-xs" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Bill Amount (taxable)</label>
                      <input type="number" value={billAmount} onChange={(e) => setBillAmount(parseFloat(e.target.value) || 0)} className="w-full border border-slate-300 px-2 py-1 text-xs text-right" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">GST %</label>
                      <input type="number" value={billGstPercent} onChange={(e) => setBillGstPercent(parseFloat(e.target.value) || 0)} className="w-full border border-slate-300 px-2 py-1 text-xs text-right" />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Vendor Bill #</label>
                      <input type="text" value={billVendorRef} onChange={(e) => setBillVendorRef(e.target.value)} placeholder="optional" className="w-full border border-slate-300 px-2 py-1 text-xs" />
                    </div>
                    <button disabled={actionLoading || billAmount <= 0} onClick={createBillFromWO} className="px-3 py-1.5 bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 disabled:opacity-50">Create Bill</button>
                  </div>
                )}
              </div>

              {/* Lifecycle actions */}
              <div className="flex flex-wrap justify-end gap-2 pt-2 border-t border-slate-200">
                {detail.status === 'DRAFT' && (
                  <>
                    <button onClick={deleteWO} disabled={actionLoading} className="px-3 py-1 bg-white border border-red-300 text-red-600 text-[11px] font-medium hover:bg-red-50 disabled:opacity-50">Delete</button>
                    <button onClick={() => openEdit(detail)} disabled={actionLoading} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50">Edit</button>
                    <button onClick={() => callAction('approve')} disabled={actionLoading} className="px-3 py-1 bg-indigo-600 text-white text-[11px] font-medium hover:bg-indigo-700 disabled:opacity-50">Approve</button>
                  </>
                )}
                {detail.status === 'APPROVED' && (
                  <>
                    <button onClick={() => callAction('cancel', { reason: window.prompt('Cancel reason?') ?? '' })} disabled={actionLoading} className="px-3 py-1 bg-white border border-red-300 text-red-600 text-[11px] font-medium hover:bg-red-50 disabled:opacity-50">Cancel</button>
                    <button onClick={() => callAction('start')} disabled={actionLoading} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">Start Work</button>
                  </>
                )}
                {detail.status === 'IN_PROGRESS' && (
                  <>
                    <button onClick={() => callAction('cancel', { reason: window.prompt('Cancel reason?') ?? '' })} disabled={actionLoading} className="px-3 py-1 bg-white border border-red-300 text-red-600 text-[11px] font-medium hover:bg-red-50 disabled:opacity-50">Cancel</button>
                    <button onClick={() => callAction('complete')} disabled={actionLoading} className="px-3 py-1 bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 disabled:opacity-50">Mark Completed</button>
                  </>
                )}
                {detail.status === 'COMPLETED' && (
                  <button onClick={() => callAction('close')} disabled={actionLoading} className="px-3 py-1 bg-green-700 text-white text-[11px] font-medium hover:bg-green-800 disabled:opacity-50">Close Work Order</button>
                )}
                <button onClick={() => setShowDetail(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
