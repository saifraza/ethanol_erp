import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import EmailThreadDrawer, { EmailThreadQuery } from '../../components/EmailThreadDrawer';
import { FileText, Send, RefreshCw, Inbox, Mail, Paperclip, HardHat } from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type SupplyType = 'INTRA_STATE' | 'INTER_STATE' | 'NON_GST';
type ContractType = 'GENERAL' | 'MANPOWER_SUPPLY';
type SkillCategory = 'SKILLED' | 'SEMI_SKILLED' | 'UNSKILLED' | 'SUPERVISOR';
type ShiftHours = 8 | 12;

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
  lineKind?: 'GENERAL' | 'MANPOWER';
  skillCategory?: string | null;
  shiftHours?: number | null;
  personCount?: number | null;
  shiftCount?: number | null;
}

interface RateCardEntry {
  category: SkillCategory | string;
  label: string;
  rate8h: number;
  rate12h: number;
}

interface ManpowerRosterRow {
  categoryKey: string; // matches RateCardEntry.category (SKILLED etc.)
  shiftHours: ShiftHours;
  personCount: number;
  shiftCount: number; // days
  gstPercent: number;
  remarks: string;
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
  contractType?: ContractType;
  manpowerRateCard?: RateCardEntry[] | null;
  contractorId: string;
  contractor: { id: string; name: string; contractorCode?: string; gstin?: string | null; email?: string | null; phone?: string | null; tdsSection?: string; tdsPercent?: number };
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

// Default rate card seed for new manpower supply contracts. Rates are placeholders
// in INR per shift — operators must set actuals before saving.
const DEFAULT_RATE_CARD: RateCardEntry[] = [
  { category: 'SKILLED',      label: 'Skilled',      rate8h: 0, rate12h: 0 },
  { category: 'SEMI_SKILLED', label: 'Semi-skilled', rate8h: 0, rate12h: 0 },
  { category: 'UNSKILLED',    label: 'Unskilled',    rate8h: 0, rate12h: 0 },
  { category: 'SUPERVISOR',   label: 'Supervisor',   rate8h: 0, rate12h: 0 },
];

const emptyRosterRow = (categoryKey = 'SKILLED'): ManpowerRosterRow => ({
  categoryKey,
  shiftHours: 8,
  personCount: 1,
  shiftCount: 30,
  gstPercent: 18,
  remarks: '',
});

// Manpower supply HSN/SAC — manpower supply services classify as SAC 998519.
const MANPOWER_SAC = '998519';

// Convert one roster row → DraftLine (so the existing line/tax pipeline keeps working)
const rosterToLine = (row: ManpowerRosterRow, rateCard: RateCardEntry[]): DraftLine => {
  const entry = rateCard.find((e) => e.category === row.categoryKey);
  const label = entry?.label ?? row.categoryKey;
  const rate = row.shiftHours === 8 ? (entry?.rate8h ?? 0) : (entry?.rate12h ?? 0);
  const unit = row.shiftHours === 8 ? 'MAN-DAY-8H' : 'MAN-DAY-12H';
  const description = `${label} — ${row.personCount} pax × ${row.shiftCount} days × ${row.shiftHours}h shift`;
  return {
    description,
    hsnSac: MANPOWER_SAC,
    quantity: row.personCount * row.shiftCount,
    unit,
    rate,
    discountPercent: 0,
    gstPercent: row.gstPercent,
    remarks: row.remarks,
  };
};

// Re-hydrate roster rows from saved WorkOrderLine[] (used when editing)
const linesToRoster = (lines: WorkOrderLine[] | undefined): ManpowerRosterRow[] => {
  if (!lines || lines.length === 0) return [emptyRosterRow()];
  return lines
    .filter((l) => l.lineKind === 'MANPOWER' || l.shiftHours)
    .map((l) => ({
      categoryKey: l.skillCategory ?? 'SKILLED',
      shiftHours: (l.shiftHours === 12 ? 12 : 8) as ShiftHours,
      personCount: l.personCount ?? 1,
      shiftCount: l.shiftCount ?? 1,
      gstPercent: l.gstPercent ?? 18,
      remarks: l.remarks ?? '',
    }));
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function WorkOrders() {
  const navigate = useNavigate();
  const [data, setData] = useState<WorkOrder[]>([]);
  const [stats, setStats] = useState<Stats>({ total: 0, draft: 0, approved: 0, inProgress: 0, completed: 0, closed: 0, totalValue: 0, totalBilled: 0, totalUnbilled: 0 });
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [contractTab, setContractTab] = useState<ContractType>('GENERAL');
  const [contractors, setContractors] = useState<ContractorOption[]>([]);

  // create/edit modal
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [formContractType, setFormContractType] = useState<ContractType>('GENERAL');
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
  // Manpower form state
  const [formRateCard, setFormRateCard] = useState<RateCardEntry[]>(DEFAULT_RATE_CARD);
  const [formRoster, setFormRoster] = useState<ManpowerRosterRow[]>([emptyRosterRow()]);
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

  // email drawer state — RFQ-style flow
  const [emailDrawer, setEmailDrawer] = useState<WorkOrder | null>(null);
  const [emailExtraMessage, setEmailExtraMessage] = useState('');
  const [emailCc, setEmailCc] = useState('');
  const [emailSending, setEmailSending] = useState(false);
  const [emailPdfUrl, setEmailPdfUrl] = useState<string | null>(null);
  const [emailStatus, setEmailStatus] = useState<{ sent: boolean; sentAt?: string; sentTo?: string; sentBy?: string; replyCount?: number; threadId?: string } | null>(null);
  const [emailReplies, setEmailReplies] = useState<Array<{ id: string; from: string; fromName?: string | null; date: string; bodyText: string; attachments: Array<{ filename: string; size: number; contentType: string }> }>>([]);
  const [emailRepliesLoading, setEmailRepliesLoading] = useState(false);

  // full thread drawer (gmail-style)
  const [threadDrawerQuery, setThreadDrawerQuery] = useState<EmailThreadQuery | null>(null);
  const [threadDrawerTitle, setThreadDrawerTitle] = useState('');
  const [threadDrawerContext, setThreadDrawerContext] = useState('');

  /* ----- fetchers ----- */

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { contractType: contractTab };
      if (statusFilter !== 'ALL') params.status = statusFilter;
      const res = await api.get<{ orders: WorkOrder[]; stats: Stats }>('/work-orders', { params });
      setData(res.data.orders ?? []);
      if (res.data.stats) setStats(res.data.stats);
    } catch (err) {
      console.error('Failed to fetch work orders:', err);
    } finally {
      setLoading(false);
    }
  }, [statusFilter, contractTab]);

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

  // For manpower contracts, derive lines from roster + rate card. For general, use formLines as-is.
  const effectiveLines: DraftLine[] = useMemo(() => {
    if (formContractType === 'MANPOWER_SUPPLY') {
      return formRoster
        .filter((r) => r.personCount > 0 && r.shiftCount > 0)
        .map((r) => rosterToLine(r, formRateCard));
    }
    return formLines;
  }, [formContractType, formRoster, formRateCard, formLines]);

  const formTotals = useMemo(() => {
    const isNonGst = formSupplyType === 'NON_GST';
    const lines = effectiveLines.map((l) => {
      const amount = r2(l.quantity * l.rate);
      const discountAmount = r2(amount * (l.discountPercent / 100));
      const taxableAmount = r2(amount - discountAmount);
      const totalGst = isNonGst ? 0 : r2(taxableAmount * (l.gstPercent / 100));
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
  }, [effectiveLines, formSupplyType, formRetention, formContractorId, contractors]);

  /* ----- form actions ----- */

  const updateLine = (idx: number, field: keyof DraftLine, value: string | number) => {
    setFormLines((prev) => prev.map((l, i) => (i === idx ? { ...l, [field]: value } : l)));
  };

  const removeLine = (idx: number) => {
    setFormLines((prev) => (prev.length === 1 ? [emptyLine()] : prev.filter((_, i) => i !== idx)));
  };

  const resetForm = (kind: ContractType = 'GENERAL') => {
    setEditId(null);
    setFormContractType(kind);
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
    setFormRateCard(DEFAULT_RATE_CARD.map((e) => ({ ...e })));
    setFormRoster([emptyRosterRow()]);
  };

  const openCreate = () => {
    resetForm(contractTab);
    setShowForm(true);
  };

  const openEdit = (wo: WorkOrder) => {
    const kind: ContractType = wo.contractType ?? 'GENERAL';
    setEditId(wo.id);
    setFormContractType(kind);
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
    if (kind === 'MANPOWER_SUPPLY') {
      const card = (wo.manpowerRateCard && wo.manpowerRateCard.length > 0) ? wo.manpowerRateCard : DEFAULT_RATE_CARD;
      setFormRateCard(card.map((e) => ({ ...e })));
      setFormRoster(linesToRoster(wo.lines));
      setFormLines([emptyLine()]); // unused in this mode
    } else {
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
    }
    setShowDetail(false);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!formContractorId || !formTitle.trim()) return;

    let payloadLines: Array<Record<string, unknown>> = [];
    if (formContractType === 'MANPOWER_SUPPLY') {
      const validRoster = formRoster.filter((r) => r.personCount > 0 && r.shiftCount > 0);
      if (validRoster.length === 0) {
        alert('Add at least one supply row (people × days).');
        return;
      }
      // Each rate must be > 0 — block empty rate card
      const badRow = validRoster.find((r) => {
        const e = formRateCard.find((c) => c.category === r.categoryKey);
        const rate = r.shiftHours === 8 ? (e?.rate8h ?? 0) : (e?.rate12h ?? 0);
        return rate <= 0;
      });
      if (badRow) {
        alert(`Rate not set for "${badRow.categoryKey}" at ${badRow.shiftHours}hr shift. Fill the rate card first.`);
        return;
      }
      payloadLines = validRoster.map((r) => {
        const entry = formRateCard.find((e) => e.category === r.categoryKey);
        const label = entry?.label ?? r.categoryKey;
        const rate = r.shiftHours === 8 ? (entry?.rate8h ?? 0) : (entry?.rate12h ?? 0);
        return {
          description: `${label} — ${r.personCount} pax × ${r.shiftCount} days × ${r.shiftHours}h shift`,
          hsnSac: MANPOWER_SAC,
          quantity: r.personCount * r.shiftCount,
          unit: r.shiftHours === 8 ? 'MAN-DAY-8H' : 'MAN-DAY-12H',
          rate,
          discountPercent: 0,
          gstPercent: r.gstPercent,
          remarks: r.remarks || null,
          lineKind: 'MANPOWER',
          skillCategory: r.categoryKey,
          shiftHours: r.shiftHours,
          personCount: r.personCount,
          shiftCount: r.shiftCount,
        };
      });
    } else {
      const validLines = formLines.filter((l) => l.description.trim() && l.quantity > 0 && l.rate > 0);
      if (validLines.length === 0) return;
      payloadLines = validLines.map((l) => ({
        description: l.description,
        hsnSac: l.hsnSac || null,
        quantity: l.quantity,
        unit: l.unit || 'NOS',
        rate: l.rate,
        discountPercent: l.discountPercent,
        gstPercent: l.gstPercent,
        remarks: l.remarks || null,
        lineKind: 'GENERAL',
      }));
    }

    setSaving(true);
    try {
      const payload = {
        contractorId: formContractorId,
        contractType: formContractType,
        manpowerRateCard: formContractType === 'MANPOWER_SUPPLY' ? formRateCard : null,
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
        lines: payloadLines,
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
      setBillGstPercent(res.data.supplyType === 'NON_GST' ? 0 : (res.data.lines?.[0]?.gstPercent ?? 18));
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

  const downloadPdf = async () => {
    if (!detail) return;
    try {
      const res = await api.get(`/work-orders/${detail.id}/pdf`, { responseType: 'blob' });
      const url = URL.createObjectURL(new Blob([res.data], { type: 'application/pdf' }));
      const a = document.createElement('a');
      a.href = url;
      a.target = '_blank';
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert('Failed to generate PDF');
    }
  };

  const fetchEmailPdfBlob = async (woId: string) => {
    try {
      const res = await api.get(`/work-orders/${woId}/pdf`, { responseType: 'blob' });
      const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
      setEmailPdfUrl(URL.createObjectURL(blob));
    } catch {
      setEmailPdfUrl(null);
    }
  };

  const loadEmailStatus = async (woId: string) => {
    try {
      const res = await api.get<{ sent: boolean; sentAt?: string; sentTo?: string; sentBy?: string; replyCount?: number; threadId?: string }>(`/work-orders/${woId}/email-status`);
      setEmailStatus(res.data);
      if (res.data.sent) loadEmailReplies(woId);
    } catch {
      setEmailStatus({ sent: false });
    }
  };

  const loadEmailReplies = async (woId: string) => {
    setEmailRepliesLoading(true);
    try {
      const res = await api.get<{ replies: Array<{ id: string; from: string; fromName?: string | null; date: string; bodyText: string; attachments: Array<{ filename: string; size: number; contentType: string }> }> }>(`/work-orders/${woId}/replies`);
      setEmailReplies(res.data.replies || []);
    } catch {
      setEmailReplies([]);
    } finally {
      setEmailRepliesLoading(false);
    }
  };

  const openEmailDrawer = (wo: WorkOrder) => {
    setEmailDrawer(wo);
    setEmailExtraMessage('');
    setEmailCc('');
    setEmailReplies([]);
    setEmailStatus(null);
    setEmailPdfUrl(null);
    fetchEmailPdfBlob(wo.id);
    loadEmailStatus(wo.id);
  };

  const closeEmailDrawer = () => {
    if (emailPdfUrl) URL.revokeObjectURL(emailPdfUrl);
    setEmailDrawer(null);
    setEmailReplies([]);
    setEmailStatus(null);
    setEmailPdfUrl(null);
  };

  const handleSendEmail = async () => {
    if (!emailDrawer) return;
    if (!emailDrawer.contractor.email) {
      alert('This contractor has no email on file. Add one in the contractor master.');
      return;
    }
    setEmailSending(true);
    try {
      const res = await api.post<{ ok: boolean; sentTo: string }>(`/work-orders/${emailDrawer.id}/send-email`, {
        extraMessage: emailExtraMessage || undefined,
        cc: emailCc || undefined,
      });
      alert(`Email sent to ${res.data.sentTo}. Watch this drawer for replies.`);
      setTimeout(() => loadEmailStatus(emailDrawer.id), 500);
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Send failed — check SMTP_USER / SMTP_PASS env vars');
    }
    setEmailSending(false);
  };

  const openWoAttachment = async (woId: string, replyId: string, filename: string) => {
    try {
      const res = await api.get(`/work-orders/${woId}/replies/${replyId}/attachment/${encodeURIComponent(filename)}`, { responseType: 'blob' });
      const url = URL.createObjectURL(res.data as Blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to load attachment');
    }
  };

  const fmtEmailDate = (iso?: string | null) => {
    if (!iso) return '--';
    const dt = new Date(iso);
    return dt.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) + ' · ' + dt.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
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
            <h1 className="text-sm font-bold tracking-wide uppercase">
              {contractTab === 'MANPOWER_SUPPLY' ? 'Manpower Supply Contracts' : 'Contractor Work Orders'}
            </h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">
              {contractTab === 'MANPOWER_SUPPLY'
                ? 'Rate card · 8hr / 12hr shift · people × days · GST + TDS'
                : 'PO-style scope authorisation, GST + TDS, progress & billing'}
            </span>
          </div>
          <button
            onClick={openCreate}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
          >
            {contractTab === 'MANPOWER_SUPPLY' ? '+ New Manpower Contract' : '+ New Work Order'}
          </button>
        </div>

        {/* Contract type tabs */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 flex items-stretch">
          {([
            { key: 'GENERAL', label: 'Work Orders', hint: 'civil / fab / repair scope' },
            { key: 'MANPOWER_SUPPLY', label: 'Manpower Supply', hint: 'people × days × shift rate' },
          ] as Array<{ key: ContractType; label: string; hint: string }>).map((t) => (
            <button
              key={t.key}
              onClick={() => setContractTab(t.key)}
              className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-r border-slate-200 ${
                contractTab === t.key
                  ? 'bg-slate-800 text-white border-b-2 border-b-blue-500'
                  : 'bg-white text-slate-600 hover:bg-slate-50'
              }`}
            >
              <div>{t.label}</div>
              <div className={`text-[9px] tracking-wide normal-case font-normal mt-0.5 ${contractTab === t.key ? 'text-slate-400' : 'text-slate-400'}`}>{t.hint}</div>
            </button>
          ))}
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
                      <div className="flex items-center justify-center gap-1.5">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColor[row.status] ?? statusColor.DRAFT}`}>
                          {row.status.replace('_', ' ')}
                        </span>
                        {row.contractType === 'MANPOWER_SUPPLY' && (
                          <button
                            onClick={(e) => { e.stopPropagation(); navigate(`/hr/labor-workers?workOrderId=${row.id}&contractorId=${row.contractor?.id ?? ''}`); }}
                            className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 inline-flex items-center gap-1"
                            title="Manage labor workers for this contract"
                          >
                            <HardHat className="w-2.5 h-2.5" /> Workers
                          </button>
                        )}
                      </div>
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
                {editId
                  ? (formContractType === 'MANPOWER_SUPPLY' ? 'Edit Manpower Contract' : 'Edit Work Order')
                  : (formContractType === 'MANPOWER_SUPPLY' ? 'New Manpower Supply Contract' : 'New Work Order')}
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
                  <select value={formSupplyType} onChange={(e) => {
                    const v = e.target.value as SupplyType;
                    setFormSupplyType(v);
                    if (v === 'NON_GST') {
                      setFormLines((prev) => prev.map((l) => ({ ...l, gstPercent: 0 })));
                      setFormRoster((prev) => prev.map((r) => ({ ...r, gstPercent: 0 })));
                    }
                  }} className="w-full border border-slate-300 px-2 py-1.5 text-xs">
                    <option value="INTRA_STATE">Intra-state (CGST + SGST)</option>
                    <option value="INTER_STATE">Inter-state (IGST)</option>
                    <option value="NON_GST">Non-GST (No tax)</option>
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

              {/* Lines table — GENERAL contracts only */}
              {formContractType === 'GENERAL' && (
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
              )}

              {/* Manpower rate card + supply roster — MANPOWER_SUPPLY only */}
              {formContractType === 'MANPOWER_SUPPLY' && (
              <>
                {/* Rate Card */}
                <div className="border border-slate-300">
                  <div className="bg-slate-200 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700">Rate Card — INR per shift (excl. GST)</span>
                    <span className="text-[9px] text-slate-500 normal-case">SAC {MANPOWER_SAC} · Manpower Supply Services</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-slate-500">
                        <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-widest font-semibold border-r border-slate-200 w-32">Category</th>
                        <th className="text-left px-2 py-1.5 text-[10px] uppercase tracking-widest font-semibold border-r border-slate-200">Label</th>
                        <th className="text-right px-2 py-1.5 text-[10px] uppercase tracking-widest font-semibold border-r border-slate-200 w-32">Rate / 8hr shift</th>
                        <th className="text-right px-2 py-1.5 text-[10px] uppercase tracking-widest font-semibold border-r border-slate-200 w-32">Rate / 12hr shift</th>
                        <th className="text-center px-2 py-1.5 text-[10px] uppercase tracking-widest font-semibold w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {formRateCard.map((entry, idx) => (
                        <tr key={idx} className={`border-b border-slate-100 ${idx % 2 ? 'bg-slate-50/70' : ''}`}>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input
                              type="text"
                              value={entry.category}
                              onChange={(e) => setFormRateCard((prev) => prev.map((c, i) => i === idx ? { ...c, category: e.target.value.toUpperCase().replace(/\s+/g, '_') } : c))}
                              className="w-full border border-slate-300 px-2 py-1 text-xs font-mono"
                            />
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input
                              type="text"
                              value={entry.label}
                              onChange={(e) => setFormRateCard((prev) => prev.map((c, i) => i === idx ? { ...c, label: e.target.value } : c))}
                              placeholder="e.g. Skilled — Welder"
                              className="w-full border border-slate-300 px-2 py-1 text-xs"
                            />
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input
                              type="number"
                              value={entry.rate8h}
                              onChange={(e) => setFormRateCard((prev) => prev.map((c, i) => i === idx ? { ...c, rate8h: parseFloat(e.target.value) || 0 } : c))}
                              className="w-full border border-slate-300 px-2 py-1 text-xs text-right font-mono"
                            />
                          </td>
                          <td className="px-1 py-1 border-r border-slate-100">
                            <input
                              type="number"
                              value={entry.rate12h}
                              onChange={(e) => setFormRateCard((prev) => prev.map((c, i) => i === idx ? { ...c, rate12h: parseFloat(e.target.value) || 0 } : c))}
                              className="w-full border border-slate-300 px-2 py-1 text-xs text-right font-mono"
                            />
                          </td>
                          <td className="px-1 py-1 text-center">
                            <button
                              onClick={() => setFormRateCard((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))}
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
                      onClick={() => setFormRateCard((prev) => [...prev, { category: 'CUSTOM', label: '', rate8h: 0, rate12h: 0 }])}
                      className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                    >
                      + Add Category
                    </button>
                  </div>
                </div>

                {/* Supply roster */}
                <div className="border border-slate-300 overflow-x-auto">
                  <div className="bg-slate-200 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700">Manpower Supply Roster</span>
                    <span className="text-[9px] text-slate-500 normal-case">qty = people × days · rate from card · GST per row</span>
                  </div>
                  <table className="w-full text-xs min-w-[900px]">
                    <thead>
                      <tr className="bg-slate-800 text-white">
                        <th className="text-left  px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-8">#</th>
                        <th className="text-left  px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Category</th>
                        <th className="text-left  px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Shift</th>
                        <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Rate / shift</th>
                        <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">People</th>
                        <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Days</th>
                        <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">GST%</th>
                        <th className="text-right px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-32">Line Total</th>
                        <th className="text-center px-2 py-2 font-semibold text-[10px] uppercase tracking-widest w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {formRoster.map((row, idx) => {
                        const tot = formTotals.lines[idx];
                        const entry = formRateCard.find((e) => e.category === row.categoryKey);
                        const rate = row.shiftHours === 8 ? (entry?.rate8h ?? 0) : (entry?.rate12h ?? 0);
                        return (
                          <tr key={idx} className={`border-b border-slate-100 ${idx % 2 ? 'bg-slate-50/70' : ''}`}>
                            <td className="px-2 py-1 text-slate-400 border-r border-slate-100">{idx + 1}</td>
                            <td className="px-1 py-1 border-r border-slate-100">
                              <select
                                value={row.categoryKey}
                                onChange={(e) => setFormRoster((prev) => prev.map((r, i) => i === idx ? { ...r, categoryKey: e.target.value } : r))}
                                className="w-full border border-slate-300 px-2 py-1 text-xs"
                              >
                                {formRateCard.map((c) => (
                                  <option key={c.category} value={c.category}>{c.label || c.category}</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-1 py-1 border-r border-slate-100">
                              <select
                                value={row.shiftHours}
                                onChange={(e) => setFormRoster((prev) => prev.map((r, i) => i === idx ? { ...r, shiftHours: (parseInt(e.target.value) === 12 ? 12 : 8) as ShiftHours } : r))}
                                className="w-full border border-slate-300 px-2 py-1 text-xs"
                              >
                                <option value={8}>8 hr</option>
                                <option value={12}>12 hr</option>
                              </select>
                            </td>
                            <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtCurrency(rate)}</td>
                            <td className="px-1 py-1 border-r border-slate-100">
                              <input
                                type="number"
                                value={row.personCount}
                                min={1}
                                onChange={(e) => setFormRoster((prev) => prev.map((r, i) => i === idx ? { ...r, personCount: parseInt(e.target.value) || 0 } : r))}
                                className="w-full border border-slate-300 px-2 py-1 text-xs text-right font-mono"
                              />
                            </td>
                            <td className="px-1 py-1 border-r border-slate-100">
                              <input
                                type="number"
                                value={row.shiftCount}
                                min={1}
                                onChange={(e) => setFormRoster((prev) => prev.map((r, i) => i === idx ? { ...r, shiftCount: parseInt(e.target.value) || 0 } : r))}
                                className="w-full border border-slate-300 px-2 py-1 text-xs text-right font-mono"
                              />
                            </td>
                            <td className="px-1 py-1 border-r border-slate-100">
                              <input
                                type="number"
                                value={row.gstPercent}
                                onChange={(e) => setFormRoster((prev) => prev.map((r, i) => i === idx ? { ...r, gstPercent: parseFloat(e.target.value) || 0 } : r))}
                                className="w-full border border-slate-300 px-2 py-1 text-xs text-right font-mono"
                              />
                            </td>
                            <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-800 font-medium border-r border-slate-100">{fmtCurrency(tot?.lineTotal ?? 0)}</td>
                            <td className="px-1 py-1 text-center">
                              <button
                                onClick={() => setFormRoster((prev) => prev.length === 1 ? prev : prev.filter((_, i) => i !== idx))}
                                className="text-red-500 hover:text-red-700 text-[10px] font-bold"
                              >
                                DEL
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  <div className="px-3 py-1.5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
                    <button
                      onClick={() => setFormRoster((prev) => [...prev, emptyRosterRow(formRateCard[0]?.category ?? 'SKILLED')])}
                      className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                    >
                      + Add Supply Row
                    </button>
                    <span className="text-[10px] text-slate-500">
                      Total man-days:{' '}
                      <span className="font-mono tabular-nums text-slate-700 font-bold">
                        {formRoster.reduce((s, r) => s + (r.personCount * r.shiftCount), 0)}
                      </span>
                    </span>
                  </div>
                </div>
              </>
              )}

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
                  {formSupplyType === 'NON_GST' ? (
                    <div className="flex justify-between px-3 py-1.5 text-xs border-b border-slate-100"><span className="text-slate-500">GST</span><span className="font-mono tabular-nums text-slate-400">N/A — Non-GST</span></div>
                  ) : formSupplyType === 'INTRA_STATE' ? (
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
                <span className="text-xs font-bold uppercase tracking-widest">
                  {detail.contractType === 'MANPOWER_SUPPLY' ? 'Manpower Contract' : 'Work Order'} WO-{detail.woNo}
                </span>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColor[detail.status] ?? statusColor.DRAFT}`}>
                  {detail.status.replace('_', ' ')}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {detail.contractType === 'MANPOWER_SUPPLY' && (
                  <button
                    onClick={() => navigate(`/hr/labor-workers?workOrderId=${detail.id}&contractorId=${detail.contractor.id}`)}
                    className="px-3 py-1 bg-amber-600 hover:bg-amber-700 text-white text-[10px] font-bold uppercase tracking-widest inline-flex items-center gap-1"
                    title="Add and manage labor workers under this manpower contract"
                  >
                    <HardHat className="w-3 h-3" /> Manage Labor Workers
                  </button>
                )}
                <button onClick={() => setShowDetail(false)} className="text-slate-400 hover:text-white text-sm">X</button>
              </div>
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
                <button onClick={downloadPdf} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Print / PDF</button>
                <button onClick={() => openEmailDrawer(detail)} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1">
                  <Mail size={11} /> Email Contractor
                </button>
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

      {/* ===================== EMAIL DRAWER (RFQ-style) ===================== */}
      {emailDrawer && (
        <div className="fixed inset-0 bg-black/40 flex items-stretch justify-end z-50" onClick={closeEmailDrawer}>
          <div className="bg-white shadow-2xl w-full max-w-4xl flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
              <div className="flex items-center gap-3">
                <FileText size={16} />
                <h2 className="text-xs font-bold uppercase tracking-widest">
                  {emailDrawer.contractType === 'MANPOWER_SUPPLY' ? 'Manpower Contract' : 'Work Order'} WO-{emailDrawer.woNo} → {emailDrawer.contractor.name}
                </h2>
              </div>
              <button onClick={closeEmailDrawer} className="text-slate-400 hover:text-white text-xs">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {/* Status strip */}
              <div className="grid grid-cols-3 gap-2 text-[11px]">
                <div className="bg-slate-50 border border-slate-200 px-3 py-2">
                  <div className="text-[9px] text-slate-500 uppercase tracking-widest">To</div>
                  <div className="font-bold text-slate-800 truncate" title={emailDrawer.contractor.gstin || ''}>
                    {emailDrawer.contractor.email || <span className="text-red-500 italic">no email on file</span>}
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200 px-3 py-2">
                  <div className="text-[9px] text-slate-500 uppercase tracking-widest">Sent</div>
                  <div className="font-bold text-slate-800">
                    {emailStatus?.sent ? fmtEmailDate(emailStatus.sentAt) : <span className="text-slate-400 italic">not sent</span>}
                  </div>
                </div>
                <div className="bg-slate-50 border border-slate-200 px-3 py-2">
                  <div className="text-[9px] text-slate-500 uppercase tracking-widest">Replies</div>
                  <div className={`font-bold ${(emailStatus?.replyCount ?? 0) > 0 ? 'text-green-700' : 'text-slate-400'}`}>
                    {(emailStatus?.replyCount ?? 0) > 0 ? `${emailStatus?.replyCount} reply` : <span className="italic">awaiting</span>}
                  </div>
                </div>
              </div>

              {/* PDF Preview */}
              <div className="border border-slate-300">
                <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between">
                  <div className="text-[10px] font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1">
                    <FileText size={12} /> Work Order Document Preview
                  </div>
                  {emailPdfUrl
                    ? <a href={emailPdfUrl} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 hover:text-blue-800 underline">Open in new tab</a>
                    : <span className="text-[10px] text-slate-400">loading...</span>}
                </div>
                {emailPdfUrl
                  ? <iframe src={emailPdfUrl} className="w-full h-[480px]" title="WO PDF" />
                  : <div className="h-[480px] flex items-center justify-center text-xs text-slate-400">Generating PDF preview...</div>}
              </div>

              {/* Send form (only if not sent yet) */}
              {!emailStatus?.sent && (
                <div className="border border-slate-300 p-3 space-y-2">
                  <div className="text-[10px] font-bold text-slate-700 uppercase tracking-widest">Send via Email</div>
                  <div className="grid grid-cols-1 gap-2">
                    <div>
                      <label className="text-[9px] text-slate-500 uppercase tracking-widest">Additional Message (optional)</label>
                      <textarea
                        value={emailExtraMessage}
                        onChange={(e) => setEmailExtraMessage(e.target.value)}
                        rows={3}
                        placeholder="e.g. 'Please confirm start date and provide list of supervisors before mobilisation.'"
                        className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none resize-none"
                      />
                    </div>
                    <div>
                      <label className="text-[9px] text-slate-500 uppercase tracking-widest">CC (optional)</label>
                      <input
                        value={emailCc}
                        onChange={(e) => setEmailCc(e.target.value)}
                        placeholder="another@email.com"
                        className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none"
                      />
                    </div>
                  </div>
                  <div className="flex items-center justify-between pt-1">
                    <div className="text-[10px] text-slate-500">The PDF above is attached. Contractor is asked to reply on the same thread.</div>
                    <button
                      onClick={handleSendEmail}
                      disabled={emailSending || !emailDrawer.contractor.email}
                      className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-wide hover:bg-blue-700 disabled:bg-slate-400 flex items-center gap-1"
                    >
                      <Send size={12} /> {emailSending ? 'Sending...' : 'Send Email'}
                    </button>
                  </div>
                </div>
              )}

              {/* Replies (after sent) */}
              {emailStatus?.sent && (
                <div className="border border-slate-300">
                  <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between">
                    <div className="text-[10px] font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1">
                      <Inbox size={12} /> Contractor Replies ({emailReplies.length})
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (!emailDrawer) return;
                          setThreadDrawerQuery({ entityType: 'WORK_ORDER', entityId: emailDrawer.id });
                          setThreadDrawerTitle(`Thread — ${emailDrawer.contractor.name}`);
                          setThreadDrawerContext(`WO-${emailDrawer.woNo} · ${emailDrawer.contractor.email || ''}`);
                          closeEmailDrawer();
                        }}
                        className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700 flex items-center gap-1"
                      >
                        <Mail size={10} /> Open Full Thread View
                      </button>
                      <button
                        onClick={() => loadEmailReplies(emailDrawer.id)}
                        disabled={emailRepliesLoading}
                        className="px-2 py-0.5 bg-white border border-slate-400 text-slate-700 text-[10px] font-medium hover:bg-slate-100 disabled:opacity-50 flex items-center gap-1"
                      >
                        <RefreshCw size={10} className={emailRepliesLoading ? 'animate-spin' : ''} /> {emailRepliesLoading ? 'Checking...' : 'Check Replies'}
                      </button>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    {!emailRepliesLoading && emailReplies.length === 0 && (
                      <div className="text-[11px] text-slate-400 italic text-center py-4">
                        No replies yet. Contractor hasn't responded — click "Check Replies" to refresh.
                      </div>
                    )}
                    {emailReplies.map((r, i) => (
                      <div key={i} className="border border-slate-200">
                        <div className="bg-slate-50 border-b border-slate-200 px-3 py-1.5 flex items-center justify-between">
                          <div className="text-[11px]">
                            <span className="font-bold text-slate-800">{r.fromName || r.from}</span>
                            <span className="text-slate-500 ml-2">&lt;{r.from}&gt;</span>
                            <span className="text-slate-400 ml-2">· {fmtEmailDate(r.date)}</span>
                          </div>
                        </div>
                        <div className="p-3 text-[11px] text-slate-700 whitespace-pre-wrap max-h-60 overflow-y-auto bg-white">
                          {r.bodyText.slice(0, 2000) || '(no text body)'}
                        </div>
                        {r.attachments.length > 0 && (
                          <div className="border-t border-slate-200 px-3 py-1.5 flex items-center gap-2 flex-wrap">
                            <Paperclip size={10} className="text-slate-500" />
                            {r.attachments.map((a, ai) => (
                              <button
                                key={ai}
                                onClick={() => openWoAttachment(emailDrawer.id, r.id, a.filename)}
                                className="text-[10px] text-blue-600 hover:text-blue-800 underline flex items-center gap-0.5 bg-transparent border-0 cursor-pointer p-0"
                                title={`${(a.size / 1024).toFixed(1)} KB · ${a.contentType}`}
                              >
                                {a.filename}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================== FULL THREAD DRAWER (Gmail-style) ===================== */}
      {threadDrawerQuery && (
        <EmailThreadDrawer
          query={threadDrawerQuery}
          title={threadDrawerTitle}
          contextLabel={threadDrawerContext}
          onClose={() => setThreadDrawerQuery(null)}
        />
      )}
    </div>
  );
}
