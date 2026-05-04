import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { Plus, Check, X, Trash2, Mail, Award, RefreshCw, FileText, Send, Inbox, Sparkles, Paperclip, ChevronDown, ChevronRight, AlertCircle } from 'lucide-react';
import EmailThreadDrawer, { EmailThreadQuery } from '../components/EmailThreadDrawer';

// ── Enums ──
const URGENCIES = ['ROUTINE', 'SOON', 'URGENT', 'EMERGENCY'];
const GOODS_CATEGORIES = ['SPARE_PART', 'RAW_MATERIAL', 'CONSUMABLE', 'TOOL', 'SAFETY', 'CHEMICAL', 'MECHANICAL', 'ELECTRICAL', 'GENERAL'];
const SERVICE_CATEGORIES = ['CONSULTANCY', 'PROFESSIONAL_SERVICE', 'IT_SERVICE', 'AMC_SERVICE', 'CONTRACT_LABOR', 'CIVIL_WORK', 'TRANSPORT_SERVICE', 'OTHER_SERVICE'];
const GOODS_UNITS = ['nos', 'kg', 'ltr', 'mtr', 'set', 'pair', 'roll'];
const SERVICE_UNITS = ['lump-sum', 'man-day', 'man-hour', 'month', 'visit', 'job'];
const STATUS_TABS = ['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'PO_PENDING', 'ORDERED', 'PARTIAL_RECEIVED', 'RECEIVED', 'COMPLETED', 'REJECTED'];

const URG_COLORS: Record<string, string> = {
  ROUTINE: 'border-slate-400 bg-slate-50 text-slate-700',
  SOON: 'border-blue-500 bg-blue-50 text-blue-700',
  URGENT: 'border-orange-500 bg-orange-50 text-orange-700',
  EMERGENCY: 'border-red-600 bg-red-50 text-red-700',
};

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'border-slate-400 bg-slate-50 text-slate-600',
  SUBMITTED: 'border-blue-500 bg-blue-50 text-blue-700',
  APPROVED: 'border-green-600 bg-green-50 text-green-700',
  REJECTED: 'border-red-600 bg-red-50 text-red-700',
  PO_PENDING: 'border-amber-500 bg-amber-50 text-amber-700',
  ORDERED: 'border-purple-500 bg-purple-50 text-purple-700',
  PARTIAL_RECEIVED: 'border-amber-500 bg-amber-50 text-amber-700',
  RECEIVED: 'border-teal-600 bg-teal-50 text-teal-700',
  COMPLETED: 'border-emerald-600 bg-emerald-50 text-emerald-700',
};

// ── Types ──
interface InvItem { id: string; name: string; code: string; category: string; unit: string; currentStock: number; minStock: number; costPerUnit: number; supplier: string | null; }
interface Vendor { id: string; name: string; email: string | null; phone: string | null; contactPerson?: string | null; }

interface IndentLine {
  id: string;
  lineNo: number;
  itemName: string;
  inventoryItemId: string | null;
  quantity: number;
  unit: string;
  estimatedCost: number;
  remarks: string | null;
  inventoryItem?: { id: string; name: string; code: string; unit: string; currentStock: number } | null;
}

interface LineQuote {
  id: string;
  requisitionLineId: string;
  unitRate: number | null;
  gstPercent: number | null;
  hsnCode: string | null;
  remarks: string | null;
  source: string | null;
}

interface AdditionalCharge {
  name: string;
  percent?: number;
  amount?: number;
  basis?: string;
}

interface Quote {
  id: string;
  vendorId: string;
  vendor: Pick<Vendor, 'id' | 'name' | 'email' | 'phone'>;
  quoteRequestedAt: string | null;
  quoteRequestedBy: string | null;
  quoteEmailSubject: string | null;
  quoteEmailThreadId: string | null;
  vendorRate: number | null;
  quotedAt: string | null;
  quoteSource: string | null;
  quoteRemarks: string | null;
  // Cost-template fields (extracted by AI or edited by buyer before award)
  packingPercent?: number;
  packingAmount?: number;
  freightPercent?: number;
  freightAmount?: number;
  insurancePercent?: number;
  insuranceAmount?: number;
  loadingPercent?: number;
  loadingAmount?: number;
  isRateInclusiveOfGst?: boolean;
  tcsPercent?: number;
  deliveryBasis?: string | null;
  additionalCharges?: AdditionalCharge[];
  isAwarded: boolean;
  pricedLineCount?: number;
  createdAt: string;
}

// Item-wise rate-entry panel state — per indent line, per vendor
interface LineRateInput {
  lineId: string;
  lineNo: number;
  itemName: string;
  itemCode?: string | null;
  quantity: number;
  unit: string;
  estimatedCost: number;
  unitRate: string;   // string while editing
  gstPercent: string;
  hsnCode: string;
  discountPercent: string;
  remarks: string;
  source: string | null;
}

interface PR {
  id: string; reqNo: number; title: string; itemName: string;
  quantity: number; unit: string; estimatedCost: number;
  urgency: string; category: string; justification: string | null;
  supplier: string | null; status: string; approvedBy: string | null;
  approvedAt: string | null; rejectionReason: string | null;
  requestedBy: string; remarks: string | null; createdAt: string;
  inventoryItemId: string | null; department: string | null;
  requestedByPerson: string | null;
  issuedQty: number; purchaseQty: number;
  issuedBy: string | null; issuedAt: string | null;
  vendorId: string | null;
  vendor: Pick<Vendor, 'id' | 'name' | 'email' | 'phone'> | null;
  vendorRate: number | null;
  quotes: Quote[];
  lines: IndentLine[];
  purchaseOrders?: Array<{ id: string; poNo: number; status: string; grandTotal: number }>;
}

interface ItemHistory {
  recent: Array<{
    poNo: number; poDate: string; rate: number; quantity: number; unit: string;
    status: string; vendorName?: string;
  }>;
  stats: { minRate: number; maxRate: number; avgRate: number; lastRate: number; totalPos: number } | null;
}

interface StockCheckData { id: string; available: number; requested: number; canFulfillFromStock: number; shortfall: number; unit: string; }

// ── Pipeline step helper ──
type StepState = 'done' | 'current' | 'pending';

function pipelineSteps(pr: PR): Array<{ label: string; state: StepState; sub?: string }> {
  const status = pr.status;
  const hasQuotes = pr.quotes.length > 0;
  const hasAwarded = pr.quotes.some(q => q.isAwarded);
  return [
    { label: 'Raised', state: 'done', sub: new Date(pr.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) },
    { label: 'Quotes', state: hasAwarded ? 'done' : hasQuotes ? 'current' : status === 'DRAFT' ? 'pending' : 'pending', sub: hasQuotes ? `${pr.quotes.length} vendor${pr.quotes.length > 1 ? 's' : ''}` : '' },
    { label: 'Approved', state: ['APPROVED', 'PO_PENDING', 'ORDERED', 'RECEIVED', 'COMPLETED'].includes(status) ? 'done' : status === 'SUBMITTED' ? 'current' : 'pending', sub: pr.approvedAt ? new Date(pr.approvedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '' },
    { label: 'Issued', state: pr.issuedQty > 0 ? 'done' : 'pending', sub: pr.issuedQty > 0 ? `${pr.issuedQty} ${pr.unit}` : '' },
    { label: 'PO', state: ['ORDERED', 'RECEIVED', 'COMPLETED'].includes(status) ? 'done' : status === 'PO_PENDING' ? 'current' : 'pending', sub: pr.purchaseQty > 0 ? `${pr.purchaseQty} ${pr.unit}` : '' },
    { label: 'Received', state: ['RECEIVED', 'COMPLETED'].includes(status) ? 'done' : ['ORDERED', 'PARTIAL_RECEIVED'].includes(status) ? 'current' : 'pending' },
    { label: 'Paid', state: status === 'COMPLETED' ? 'done' : 'pending' },
  ];
}

// ──────────────────────────────────────────────────────────────
// Main component
// ──────────────────────────────────────────────────────────────
export default function PurchaseRequisition() {
  const [searchParams] = useSearchParams();
  const [reqs, setReqs] = useState<PR[]>([]);
  const [stats, setStats] = useState<{ byStatus?: Record<string, number>; total?: number; totalValue?: number; pendingValue?: number }>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'list' | 'new'>(searchParams.get('new') ? 'new' : 'list');
  const [filterStatus, setFilterStatus] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  // ── Create-indent form ──
  // Header = shared context for the whole indent (one vendor later will quote on ALL lines)
  // Lines = the individual items being requested
  type NewLine = { itemName: string; inventoryItemId: string; quantity: string; unit: string; estimatedCost: string; remarks: string; _itemQuery?: string };
  const blankLine = (): NewLine => ({ itemName: '', inventoryItemId: '', quantity: '1', unit: 'nos', estimatedCost: '', remarks: '', _itemQuery: '' });
  const [form, setForm] = useState({
    urgency: 'ROUTINE', category: 'GENERAL', justification: '', remarks: '',
    department: '', requestedByPerson: '',
  });
  const [lines, setLines] = useState<NewLine[]>([blankLine()]);
  const [focusedLine, setFocusedLine] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const updateLine = (i: number, patch: Partial<NewLine>) => setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLines(ls => [...ls, blankLine()]);
  const removeLine = (i: number) => setLines(ls => ls.length === 1 ? [blankLine()] : ls.filter((_, idx) => idx !== i));
  const duplicateLine = (i: number) => setLines(ls => [...ls.slice(0, i + 1), { ...ls[i] }, ...ls.slice(i + 1)]);
  const [invItems, setInvItems] = useState<InvItem[]>([]);
  const [departments, setDepartments] = useState<string[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  // ── Detail-drawer state ──
  const [stockCheck, setStockCheck] = useState<StockCheckData | null>(null);
  const [issueQty, setIssueQty] = useState('');
  const [issueToReqQty, setIssueToReqQty] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [itemHistory, setItemHistory] = useState<ItemHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // ── Vendor-pick modal ──
  const [vendorPickFor, setVendorPickFor] = useState<string | null>(null);
  const [vendorQuery, setVendorQuery] = useState('');

  // ── Item-wise rate panel ──
  // Which vendor row's rate panel is expanded (one at a time, nested inside the indent expansion)
  const [lineRatesPanelFor, setLineRatesPanelFor] = useState<string | null>(null);
  // Per-vendor rate inputs (indexed by vrId)
  const [lineRateInputs, setLineRateInputs] = useState<Record<string, LineRateInput[]>>({});
  const [lineRatesLoading, setLineRatesLoading] = useState<Record<string, boolean>>({});
  const [lineRatesSaving, setLineRatesSaving] = useState<Record<string, boolean>>({});
  const [lineRatesExtracting, setLineRatesExtracting] = useState<Record<string, boolean>>({});
  const [lineRatesError, setLineRatesError] = useState<Record<string, string | null>>({});
  type AiDiagnostics = {
    confidence: string;
    matched: Array<{ aiName: string | null; aiUnitRate: number | null; matched: string | null; strategy: string | null }>;
    indentLineNames: string[];
    overallRateNote?: string | null;
    extractedTotal?: number | null;
    notes?: string | null;
  };
  const [aiDiagnostics, setAiDiagnostics] = useState<Record<string, AiDiagnostics | null>>({});

  const loadLineRates = useCallback(async (prId: string, vrId: string) => {
    setLineRatesLoading(prev => ({ ...prev, [vrId]: true }));
    setLineRatesError(prev => ({ ...prev, [vrId]: null }));
    try {
      const res = await api.get<{ lines: Array<{
        lineId: string; lineNo: number; itemName: string; itemCode: string | null;
        quantity: number; unit: string; estimatedCost: number;
        unitRate: number | null; gstPercent: number | null; hsnCode: string | null; discountPercent: number; remarks: string | null; source: string | null;
      }> }>(`/purchase-requisition/${prId}/vendors/${vrId}/line-rates`);
      setLineRateInputs(prev => ({
        ...prev,
        [vrId]: res.data.lines.map(l => ({
          lineId: l.lineId, lineNo: l.lineNo, itemName: l.itemName, itemCode: l.itemCode,
          quantity: l.quantity, unit: l.unit, estimatedCost: l.estimatedCost,
          unitRate: l.unitRate != null ? String(l.unitRate) : '',
          gstPercent: l.gstPercent != null ? String(l.gstPercent) : '',
          hsnCode: l.hsnCode || '',
          discountPercent: l.discountPercent > 0 ? String(l.discountPercent) : '',
          remarks: l.remarks || '', source: l.source,
        })),
      }));
    } catch (e: unknown) {
      setLineRatesError(prev => ({ ...prev, [vrId]: (e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to load rates' }));
    }
    setLineRatesLoading(prev => ({ ...prev, [vrId]: false }));
  }, []);

  const updateLineInput = (vrId: string, lineId: string, field: keyof LineRateInput, value: string) => {
    setLineRateInputs(prev => ({
      ...prev,
      [vrId]: (prev[vrId] || []).map(l => l.lineId === lineId ? { ...l, [field]: value } : l),
    }));
  };

  const saveLineRates = async (prId: string, vrId: string) => {
    const inputs = lineRateInputs[vrId] || [];
    setLineRatesSaving(prev => ({ ...prev, [vrId]: true }));
    setLineRatesError(prev => ({ ...prev, [vrId]: null }));
    try {
      await api.put(`/purchase-requisition/${prId}/vendors/${vrId}/line-rates`, {
        lines: inputs.map(l => ({
          lineId: l.lineId,
          unitRate: l.unitRate.trim() === '' ? null : parseFloat(l.unitRate),
          gstPercent: l.gstPercent.trim() === '' ? null : parseFloat(l.gstPercent),
          hsnCode: l.hsnCode || null,
          discountPercent: l.discountPercent.trim() === '' ? 0 : parseFloat(l.discountPercent),
          remarks: l.remarks || null,
        })),
        source: 'MANUAL',
      });
      await loadLineRates(prId, vrId);
      load();
    } catch (e: unknown) {
      setLineRatesError(prev => ({ ...prev, [vrId]: (e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Save failed' }));
    }
    setLineRatesSaving(prev => ({ ...prev, [vrId]: false }));
  };

  const extractAIToLines = async (prId: string, vrId: string) => {
    const pr = reqs.find(r => r.id === prId);
    const q = pr?.quotes.find(qq => qq.id === vrId);
    if (!confirmOverwriteIfNeeded(q)) return;
    setLineRatesExtracting(prev => ({ ...prev, [vrId]: true }));
    setLineRatesError(prev => ({ ...prev, [vrId]: null }));
    setAiDiagnostics(prev => ({ ...prev, [vrId]: null }));
    try {
      const res = await api.post<{
        savedLineCount: number;
        totalLines: number;
        extracted: { confidence: string; lineRates: Array<{ itemName?: string; unitRate?: number }>; overallRateNote?: string; extractedTotal?: number; notes?: string };
        matchDiagnostics?: Array<{ aiName: string | null; aiUnitRate: number | null; matched: string | null; strategy: string | null }>;
        indentLineNames?: string[];
      }>(
        `/purchase-requisition/${prId}/vendors/${vrId}/extract-quote`,
        { autoApply: true },
        // Gemini PDF extraction takes 15-40s; the global 10s axios timeout
        // would otherwise trigger client-side retries that look like a failure.
        { timeout: 120000 },
      );
      await loadLineRates(prId, vrId);
      load();
      const { savedLineCount, totalLines, extracted, matchDiagnostics, indentLineNames } = res.data;
      setAiDiagnostics(prev => ({
        ...prev,
        [vrId]: {
          confidence: extracted.confidence,
          matched: matchDiagnostics || [],
          indentLineNames: indentLineNames || [],
          overallRateNote: extracted.overallRateNote ?? null,
          extractedTotal: extracted.extractedTotal ?? null,
          notes: extracted.notes ?? null,
        },
      }));
      if (savedLineCount === 0) {
        const aiHadRates = (matchDiagnostics || []).filter(m => m.aiUnitRate && m.aiUnitRate > 0).length;
        setLineRatesError(prev => ({
          ...prev,
          [vrId]: aiHadRates > 0
            ? `AI found ${aiHadRates} rate(s) in the reply but none matched your indent line names — see the diagnostics below to map them manually.`
            : 'AI did not find any rates in the reply / PDF — see what AI saw below, then enter rates manually.',
        }));
      } else if (extracted.confidence === 'LOW') {
        // We persisted them anyway (tagged EMAIL_AUTO_LOW) so the buyer sees a
        // draft. Award is gated server-side until the buyer edits or acknowledges.
        setLineRatesError(prev => ({
          ...prev,
          [vrId]: `AI filled ${savedLineCount} item(s) but flagged the read as LOW confidence. Verify each rate, GST, HSN, and cost component below — edit any value to clear the flag, or you'll be asked to confirm at Award.`,
        }));
      } else if (savedLineCount < totalLines) {
        setLineRatesError(prev => ({
          ...prev,
          [vrId]: `AI filled ${savedLineCount} of ${totalLines} items — review and complete the missing ones manually below.`,
        }));
      }
    } catch (e: unknown) {
      setLineRatesError(prev => ({
        ...prev,
        [vrId]: (e as { response?: { data?: { error?: string } } }).response?.data?.error || 'AI extraction failed — please enter rates manually below.',
      }));
    }
    setLineRatesExtracting(prev => ({ ...prev, [vrId]: false }));
  };

  const toggleLineRatesPanel = (prId: string, vrId: string) => {
    if (lineRatesPanelFor === vrId) {
      setLineRatesPanelFor(null);
    } else {
      setLineRatesPanelFor(vrId);
      if (!lineRateInputs[vrId]) loadLineRates(prId, vrId);
    }
  };

  // Bulk-apply an overall discount % to every line in the rate-entry panel.
  // Buyers use this to override the AI-extracted footer discount in one click
  // (e.g. negotiated up from 31% to 35% over the phone) without editing each
  // line individually. Pure local state — Save Rates persists.
  const [bulkDiscountInput, setBulkDiscountInput] = useState<Record<string, string>>({});
  const applyBulkDiscount = (vrId: string) => {
    const raw = (bulkDiscountInput[vrId] || '').trim();
    if (raw === '') return;
    const pct = parseFloat(raw);
    if (isNaN(pct) || pct < 0 || pct > 100) {
      setLineRatesError(prev => ({ ...prev, [vrId]: 'Discount must be 0–100%.' }));
      return;
    }
    setLineRateInputs(prev => ({
      ...prev,
      [vrId]: (prev[vrId] || []).map(l => ({ ...l, discountPercent: pct === 0 ? '' : String(pct) })),
    }));
    setLineRatesError(prev => ({ ...prev, [vrId]: null }));
  };

  // Inline-edit vendor terms (paymentTerms / delivery / freight come in as a
  // single quoteRemarks string from AI extraction). Save calls existing
  // PUT /:id/vendors/:vrId so we don't need a new endpoint.
  const [remarksDraft, setRemarksDraft] = useState<Record<string, string>>({});
  const [remarksSaving, setRemarksSaving] = useState<Record<string, boolean>>({});
  const saveQuoteRemarks = async (prId: string, vrId: string) => {
    const draft = remarksDraft[vrId] ?? '';
    setRemarksSaving(prev => ({ ...prev, [vrId]: true }));
    try {
      await api.put(`/purchase-requisition/${prId}/vendors/${vrId}`, { quoteRemarks: draft });
      load();
    } catch (e: unknown) {
      setLineRatesError(prev => ({ ...prev, [vrId]: (e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to save terms' }));
    }
    setRemarksSaving(prev => ({ ...prev, [vrId]: false }));
  };

  // Cost-template editor state (per vendor row). Each field is a string draft
  // so empty inputs don't get coerced to "0". Save POSTs to the same vendor
  // PUT route as remarks — no new endpoint needed.
  type CostDraft = {
    packingPercent: string; packingAmount: string;
    freightPercent: string; freightAmount: string;
    insurancePercent: string; insuranceAmount: string;
    loadingPercent: string; loadingAmount: string;
    isRateInclusiveOfGst: boolean;
    tcsPercent: string;
    deliveryBasis: string;
    additionalChargesJson: string;
  };
  const [costDraft, setCostDraft] = useState<Record<string, CostDraft>>({});
  const [costSaving, setCostSaving] = useState<Record<string, boolean>>({});
  const numStr = (n: number | undefined | null) => (n != null && n !== 0 ? String(n) : '');
  const ensureCostDraft = (q: Quote): CostDraft => costDraft[q.id] ?? {
    packingPercent: numStr(q.packingPercent), packingAmount: numStr(q.packingAmount),
    freightPercent: numStr(q.freightPercent), freightAmount: numStr(q.freightAmount),
    insurancePercent: numStr(q.insurancePercent), insuranceAmount: numStr(q.insuranceAmount),
    loadingPercent: numStr(q.loadingPercent), loadingAmount: numStr(q.loadingAmount),
    isRateInclusiveOfGst: !!q.isRateInclusiveOfGst,
    tcsPercent: numStr(q.tcsPercent),
    deliveryBasis: q.deliveryBasis ?? '',
    additionalChargesJson: q.additionalCharges && q.additionalCharges.length ? JSON.stringify(q.additionalCharges, null, 2) : '',
  };
  const updateCostDraft = (q: Quote, patch: Partial<CostDraft>) => {
    setCostDraft(prev => ({ ...prev, [q.id]: { ...ensureCostDraft(q), ...patch } }));
  };
  const saveCostComponents = async (prId: string, q: Quote) => {
    const d = ensureCostDraft(q);
    const num = (s: string) => (s.trim() === '' ? 0 : parseFloat(s) || 0);
    let additionalCharges: AdditionalCharge[] = [];
    if (d.additionalChargesJson.trim()) {
      try {
        const parsed = JSON.parse(d.additionalChargesJson);
        if (!Array.isArray(parsed)) throw new Error('must be an array');
        additionalCharges = parsed;
      } catch (err) {
        setLineRatesError(prev => ({ ...prev, [q.id]: `Additional charges JSON invalid: ${(err as Error).message}` }));
        return;
      }
    }
    setCostSaving(prev => ({ ...prev, [q.id]: true }));
    try {
      await api.put(`/purchase-requisition/${prId}/vendors/${q.id}`, {
        packingPercent: num(d.packingPercent), packingAmount: num(d.packingAmount),
        freightPercent: num(d.freightPercent), freightAmount: num(d.freightAmount),
        insurancePercent: num(d.insurancePercent), insuranceAmount: num(d.insuranceAmount),
        loadingPercent: num(d.loadingPercent), loadingAmount: num(d.loadingAmount),
        isRateInclusiveOfGst: d.isRateInclusiveOfGst,
        tcsPercent: num(d.tcsPercent),
        deliveryBasis: d.deliveryBasis || null,
        additionalCharges,
      });
      load();
    } catch (e: unknown) {
      setLineRatesError(prev => ({ ...prev, [q.id]: (e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to save cost components' }));
    }
    setCostSaving(prev => ({ ...prev, [q.id]: false }));
  };

  const load = useCallback(async () => {
    try {
      const params = filterStatus !== 'ALL' ? `?status=${filterStatus}` : '';
      const [listRes, statsRes] = await Promise.all([
        api.get<{ requisitions: PR[] }>(`/purchase-requisition${params}`),
        api.get('/purchase-requisition/stats'),
      ]);
      setReqs((listRes.data as { requisitions: PR[] }).requisitions || []);
      setStats(statsRes.data as typeof stats);
    } catch (e) { console.error(e); }
    setLoading(false);
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/inventory/items').then(r => setInvItems(r.data.items || [])).catch(() => {});
    api.get('/departments').then(r => setDepartments((r.data || []).filter((d: { isActive: boolean }) => d.isActive).map((d: { name: string }) => d.name))).catch(() => {});
    api.get('/vendors?limit=500').then(r => {
      const v = (r.data.vendors || r.data || []).map((v: { id: string; name: string; phone?: string; email?: string; contactPerson?: string }) => ({
        id: v.id, name: v.name, email: v.email || null, phone: v.phone || null, contactPerson: v.contactPerson || null,
      }));
      setVendors(v);
    }).catch(() => {});
    const itemId = searchParams.get('itemId');
    const itemName = searchParams.get('itemName');
    if (itemName) {
      setLines([{ itemName, inventoryItemId: itemId || '', quantity: '1', unit: 'nos', estimatedCost: '', remarks: '', _itemQuery: itemName }]);
    }
  }, [searchParams]);

  // ── Create a new indent (multi-line: 1+ items in one request) ──
  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.department) { alert('Department is required'); return; }
    const validLines = lines.filter(l => l.itemName.trim() && parseFloat(l.quantity) > 0);
    if (validLines.length === 0) { alert('Add at least one item with name and quantity'); return; }
    setSaving(true);
    try {
      await api.post('/purchase-requisition', {
        ...form,
        status: 'SUBMITTED',
        lines: validLines.map(l => ({
          itemName: l.itemName.trim(),
          inventoryItemId: l.inventoryItemId || undefined,
          quantity: parseFloat(l.quantity),
          unit: l.unit,
          estimatedCost: parseFloat(l.estimatedCost) || 0,
          remarks: l.remarks || undefined,
        })),
      });
      setForm({ urgency: 'ROUTINE', category: 'GENERAL', justification: '', remarks: '', department: '', requestedByPerson: '' });
      setLines([blankLine()]);
      setTab('list');
      load();
    } catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
    setSaving(false);
  };

  // ── Expand row: fetch stock + history ──
  const toggleExpand = (pr: PR) => {
    const next = expanded === pr.id ? null : pr.id;
    setExpanded(next);
    setStockCheck(null);
    setItemHistory(null);
    setIssueQty('');
    if (next) {
      if (pr.inventoryItemId && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(pr.status)) {
        api.get(`/purchase-requisition/${pr.id}/stock-check`)
          .then(r => { setStockCheck({ id: pr.id, ...r.data } as StockCheckData); setIssueQty(String(Math.min(r.data.available, pr.quantity))); })
          .catch(() => setStockCheck({ id: pr.id, available: 0, requested: pr.quantity, canFulfillFromStock: 0, shortfall: pr.quantity, unit: pr.unit }));
      }
      if (pr.inventoryItemId) {
        setHistoryLoading(true);
        api.get(`/purchase-requisition/item-history/${pr.inventoryItemId}`).then(r => setItemHistory(r.data as ItemHistory)).catch(() => setItemHistory(null)).finally(() => setHistoryLoading(false));
      }
    }
  };

  // ── Store actions ──
  const handleIssue = async (prId: string) => {
    setActionLoading(true);
    try {
      const res = await api.put(`/purchase-requisition/${prId}/issue`, { issuedQty: parseFloat(issueQty) || 0 });
      const autoPO = (res.data as { autoPO?: { created: boolean; poNo?: number; reason?: string } }).autoPO;
      setStockCheck(null); setIssueQty(''); load();
      if (autoPO) alert(autoPO.created ? `Draft PO #${autoPO.poNo} created for the shortfall` : `Shortfall queued — ${autoPO.reason || 'manual PO required'}`);
    } catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Issue failed'); }
    setActionLoading(false);
  };

  const handleFullPurchase = async (prId: string) => {
    setActionLoading(true);
    try {
      const res = await api.put(`/purchase-requisition/${prId}/issue`, { issuedQty: 0 });
      const autoPO = (res.data as { autoPO?: { created: boolean; poNo?: number; reason?: string } }).autoPO;
      setStockCheck(null); load();
      if (autoPO) alert(autoPO.created ? `Draft PO #${autoPO.poNo} created` : `Queued — ${autoPO.reason || 'manual PO required'}`);
    } catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
    setActionLoading(false);
  };

  const handleIssueToRequester = async (prId: string) => {
    const qty = parseFloat(issueToReqQty);
    if (!qty || qty <= 0) return;
    setActionLoading(true);
    try {
      await api.put(`/purchase-requisition/${prId}/issue-to-requester`, { issueNowQty: qty });
      setIssueToReqQty(''); load();
    } catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Issue failed'); }
    setActionLoading(false);
  };

  const handleReject = async () => {
    if (!rejectingId || !rejectReason.trim()) return;
    try {
      await api.put(`/purchase-requisition/${rejectingId}`, { status: 'REJECTED', rejectionReason: rejectReason });
      setRejectingId(null); setRejectReason(''); load();
    } catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
  };

  const updateStatus = async (id: string, status: string) => {
    try { await api.put(`/purchase-requisition/${id}`, { status }); load(); }
    catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
  };

  // ── Vendor/quote actions ──
  const handleAddVendor = async (prId: string, vendor: Vendor) => {
    try {
      await api.post(`/purchase-requisition/${prId}/vendors`, { vendorId: vendor.id });
      setVendorPickFor(null); setVendorQuery('');
      load();
    } catch (e: unknown) {
      const status = (e as { response?: { status?: number } }).response?.status;
      if (status === 409) alert('This vendor is already on the indent');
      else alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed');
    }
  };

  // ── RFQ drawer — preview PDF, edit message, send via SMTP, view replies ──
  type RfqReply = {
    messageId: string; from: string; fromName?: string; subject: string; date: string;
    bodyText: string; bodyHtml: string | null;
    attachments: Array<{ filename: string; size: number; contentType: string }>;
  };
  type ExtractedQuote = {
    overallRateNote?: string;
    overallDiscountPercent?: number;
    packingPercent?: number; packingAmount?: number;
    freightPercent?: number; freightAmount?: number;
    insurancePercent?: number; insuranceAmount?: number;
    loadingPercent?: number; loadingAmount?: number;
    additionalCharges?: AdditionalCharge[];
    isRateInclusiveOfGst?: boolean;
    tcsPercent?: number;
    deliveryBasis?: string;
    lineRates: Array<{ lineNo?: number; itemName?: string; unitRate?: number; gstPercent?: number; hsnCode?: string; discountPercent?: number; remarks?: string }>;
    deliveryDays?: number; paymentTerms?: string; quoteValidityDays?: number;
    freightTerms?: string; currency?: string; extractedTotal?: number; notes?: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  };
  const [rfqDrawer, setRfqDrawer] = useState<{ prId: string; quote: Quote } | null>(null);
  const [rfqExtraMessage, setRfqExtraMessage] = useState('');
  const [rfqCc, setRfqCc] = useState('');
  const [rfqSending, setRfqSending] = useState(false);
  const [replies, setReplies] = useState<RfqReply[]>([]);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [extracting, setExtracting] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<Record<string, ExtractedQuote>>({});

  // Gmail-style thread drawer — reusable across the app
  const [threadDrawerQuery, setThreadDrawerQuery] = useState<EmailThreadQuery | null>(null);
  const [threadDrawerTitle, setThreadDrawerTitle] = useState<string>('');
  const [threadDrawerContext, setThreadDrawerContext] = useState<string>('');
  const [threadDrawerOnExtract, setThreadDrawerOnExtract] = useState<((threadId: string, replyId: string) => Promise<void>) | null>(null);
  const [threadDrawerEmptyAction, setThreadDrawerEmptyAction] = useState<{ label: string; onClick: (remarks?: string) => void | Promise<void>; remarksLabel?: string; previewUrl?: string } | null>(null);

  const [rfqPdfUrl, setRfqPdfUrl] = useState<string | null>(null);
  const fetchRfqPdfBlob = async (prId: string, quoteId: string) => {
    try {
      const res = await api.get(`/purchase-requisition/${prId}/vendors/${quoteId}/rfq-pdf`, { responseType: 'blob' });
      const blob = new Blob([res.data as BlobPart], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      setRfqPdfUrl(url);
    } catch {
      setRfqPdfUrl(null);
    }
  };

  // Open an authed endpoint in a new tab by fetching as blob first
  const openAttachment = async (prId: string, quoteId: string, filename: string) => {
    try {
      const res = await api.get(`/purchase-requisition/${prId}/vendors/${quoteId}/attachment/${encodeURIComponent(filename)}`, { responseType: 'blob' });
      const blob = res.data as Blob;
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      // Don't revoke immediately — browser needs it for the tab; GC will handle eventually
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to load attachment');
    }
  };
  const openRfqDrawer = (prId: string, quote: Quote) => {
    setRfqDrawer({ prId, quote });
    setRfqExtraMessage('');
    setRfqCc('');
    setReplies([]);
    setRfqPdfUrl(null);
    fetchRfqPdfBlob(prId, quote.id);
    // If already sent, auto-load replies
    if (quote.quoteRequestedAt) loadReplies(prId, quote.id);
  };
  const closeRfqDrawer = () => {
    if (rfqPdfUrl) URL.revokeObjectURL(rfqPdfUrl);
    setRfqDrawer(null); setReplies([]); setExtracted({}); setRfqPdfUrl(null);
  };

  const handleSendRfq = async () => {
    if (!rfqDrawer) return;
    if (!rfqDrawer.quote.vendor.email) { alert('This vendor has no email on file. Add one in the vendor master.'); return; }
    setRfqSending(true);
    try {
      const res = await api.post(`/purchase-requisition/${rfqDrawer.prId}/vendors/${rfqDrawer.quote.id}/send-rfq`, {
        extraMessage: rfqExtraMessage || undefined,
        cc: rfqCc || undefined,
      });
      alert(`RFQ sent to ${res.data.sentTo}. Watch this drawer for replies.`);
      load();
      // Re-open drawer fresh so the sent state loads
      setTimeout(() => loadReplies(rfqDrawer.prId, rfqDrawer.quote.id), 500);
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Send failed — check SMTP_USER / SMTP_PASS env vars');
    }
    setRfqSending(false);
  };

  const loadReplies = async (prId: string, quoteId: string) => {
    setRepliesLoading(true);
    try {
      const res = await api.get<{
        replies: RfqReply[]; count: number; error?: string;
        autoExtract?: { savedLineCount?: number; totalLines?: number; confidence?: string; reason?: string } | null;
      }>(`/purchase-requisition/${prId}/vendors/${quoteId}/replies`);
      setReplies(res.data.replies || []);
      if (res.data.error) console.warn('[rfq]', res.data.error);
      // Server auto-filled rates from a new reply — refresh list + open panel inputs
      const auto = res.data.autoExtract;
      if (auto && (auto.savedLineCount || 0) > 0) {
        load();
        if (lineRatesPanelFor === quoteId) loadLineRates(prId, quoteId);
      }
    } catch (e: unknown) {
      console.error('Replies fetch failed', e);
      setReplies([]);
    }
    setRepliesLoading(false);
  };

  // Returns true if buyer already has values on this vendor row that AI Extract
  // would overwrite — header rate, per-line rates, cost components, or remarks.
  // Used to gate AI Extract behind a confirm() so a stray click doesn't wipe
  // negotiated edits (Saif: 2026-05-04).
  const hasExistingQuoteData = (q: Quote): string[] => {
    const fields: string[] = [];
    if (q.vendorRate != null && q.vendorRate > 0) fields.push(`header rate ₹${q.vendorRate.toLocaleString('en-IN')}`);
    if ((q.pricedLineCount || 0) > 0) fields.push(`${q.pricedLineCount} item rate(s)`);
    const costFields: Array<[string, number | undefined]> = [
      ['packing', (q.packingPercent || 0) + (q.packingAmount || 0)],
      ['freight', (q.freightPercent || 0) + (q.freightAmount || 0)],
      ['insurance', (q.insurancePercent || 0) + (q.insuranceAmount || 0)],
      ['loading', (q.loadingPercent || 0) + (q.loadingAmount || 0)],
    ];
    const setCosts = costFields.filter(([, v]) => (v || 0) > 0).map(([n]) => n);
    if (setCosts.length) fields.push(`${setCosts.join('/')} cost components`);
    if ((q.tcsPercent || 0) > 0) fields.push('TCS%');
    if (q.quoteRemarks) fields.push('remarks');
    return fields;
  };

  const confirmOverwriteIfNeeded = (q: Quote | undefined): boolean => {
    if (!q) return true;
    const existing = hasExistingQuoteData(q);
    if (existing.length === 0) return true;
    return confirm(
      `This vendor already has:\n  • ${existing.join('\n  • ')}\n\nRunning AI Extract will overwrite these with what the AI reads from the latest reply / PDF.\n\nContinue?`
    );
  };

  const handleExtractQuote = async (prId: string, quoteId: string, autoApply: boolean) => {
    const pr = reqs.find(r => r.id === prId);
    const q = pr?.quotes.find(qq => qq.id === quoteId);
    if (!confirmOverwriteIfNeeded(q)) return;
    setExtracting(quoteId);
    try {
      const res = await api.post<{ extracted: ExtractedQuote; savedRate: number | null }>(
        `/purchase-requisition/${prId}/vendors/${quoteId}/extract-quote`,
        { autoApply },
        { timeout: 120000 },  // Gemini PDF parse can take 15-40s
      );
      setExtracted(prev => ({ ...prev, [quoteId]: res.data.extracted }));
      if (res.data.savedRate) {
        alert(`AI extracted rate Rs.${res.data.savedRate.toLocaleString('en-IN')} and applied to this vendor.`);
        load();
      }
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error || 'AI extraction failed';
      alert(msg);
    }
    setExtracting(null);
  };

  const handleAward = async (prId: string, quoteId: string) => {
    if (!confirm('Award this vendor? A DRAFT PO will be created. You can review it, then either Confirm (proceeds to GRN) or Cancel (returns the indent for re-quoting).')) return;
    const tryAward = async (acknowledgeLowConfidence = false) => api.post<{
      autoPO?: { created: boolean; poId?: string; poNo?: number; grandTotal?: number; reason?: string };
    }>(`/purchase-requisition/${prId}/vendors/${quoteId}/award`, { acknowledgeLowConfidence });
    try {
      let res;
      try {
        res = await tryAward();
      } catch (e: unknown) {
        const err = e as { response?: { status?: number; data?: { error?: string; code?: string } } };
        if (err.response?.data?.code === 'LOW_CONFIDENCE_AWARD') {
          if (!confirm(`${err.response.data.error}\n\nProceed with award anyway?`)) return;
          res = await tryAward(true);
        } else {
          throw e;
        }
      }
      const { autoPO } = res.data;
      load();
      if (autoPO?.created && autoPO.poNo) {
        alert(`Awarded.\nDraft PO #${autoPO.poNo} created (₹${(autoPO.grandTotal || 0).toLocaleString('en-IN')}).\n\nGoing to Store Receipts → Purchase Orders to review. Confirm to proceed, or Cancel & Re-quote to revert.`);
        window.location.href = `/store/receipts?tab=pos`;
        return;
      } else if (autoPO?.poId && autoPO?.poNo) {
        alert(`Awarded. PO #${autoPO.poNo} already exists for this indent. Going to Store Receipts.`);
        window.location.href = `/store/receipts?tab=pos`;
        return;
      } else {
        alert(`Awarded, but DRAFT PO was not auto-created: ${autoPO?.reason || 'unknown reason'}. Create a PO manually from Procurement Actions.`);
      }
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed');
    }
  };

  const handleDeleteQuote = async (prId: string, quoteId: string) => {
    if (!confirm('Remove this vendor row?')) return;
    try { await api.delete(`/purchase-requisition/${prId}/vendors/${quoteId}`); load(); }
    catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
  };

  // ── Filter list ──
  // When an indent is expanded, focus on it alone — hide all other indents to
  // remove the visual noise of unrelated rows below the open detail.
  const filtered = reqs.filter(pr => {
    if (expanded && pr.id !== expanded) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return pr.itemName.toLowerCase().includes(q) || pr.title.toLowerCase().includes(q) || String(pr.reqNo).includes(q) || (pr.department || '').toLowerCase().includes(q) || (pr.vendor?.name || '').toLowerCase().includes(q);
  });

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

  if (loading) return <div className="p-6 text-center text-xs text-slate-400">Loading indents...</div>;

  return (
    <div className="space-y-0">
      {/* ── Toolbar ── */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">Indents</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Raise need → Request quotes → Award vendor → Issue / Purchase → Receive → Pay</span>
        </div>
        <button onClick={() => setTab('new')}
          className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1">
          <Plus size={14} /> New Indent
        </button>
      </div>

      {/* ── Compact stats strip ── */}
      <div className="grid grid-cols-4 md:grid-cols-8 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        {STATUS_TABS.map(s => {
          const count = s === 'ALL' ? (stats.total || 0) : (stats.byStatus?.[s] || 0);
          const active = filterStatus === s;
          return (
            <button key={s} onClick={() => { setFilterStatus(s); setExpanded(null); }}
              className={`bg-white px-3 py-2 text-left border-r border-slate-200 hover:bg-blue-50/60 transition ${active ? 'ring-2 ring-inset ring-blue-500 bg-blue-50' : ''}`}>
              <div className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">{s.replace('_', ' ')}</div>
              <div className="text-lg font-bold text-slate-800 font-mono tabular-nums">{count}</div>
            </button>
          );
        })}
      </div>

      {/* ── Search + Tabs ── */}
      <div className="bg-slate-100 border-x border-b border-slate-300 -mx-3 md:-mx-6 flex items-center justify-between px-4">
        <div className="flex gap-0 items-center">
          <button onClick={() => setTab('list')}
            className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 transition ${tab === 'list' ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            All Indents ({reqs.length})
          </button>
          <button onClick={() => setTab('new')}
            className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 transition ${tab === 'new' ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            + New Indent
          </button>
          {tab === 'list' && expanded && (() => {
            const focused = reqs.find(r => r.id === expanded);
            return (
              <button onClick={() => { setExpanded(null); setLineRatesPanelFor(null); }}
                className="ml-3 px-2 py-1 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700 flex items-center gap-1">
                ← Back to All Indents{focused ? ` (focused: #${focused.reqNo})` : ''}
              </button>
            );
          })()}
        </div>
        {tab === 'list' && (
          <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item, req#, vendor, dept..."
            className="border border-slate-300 px-2.5 py-1 text-xs w-64 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        )}
      </div>

      {/* ── NEW INDENT FORM (multi-line) ── */}
      {tab === 'new' && (
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
          <div className="bg-slate-100 border-b border-slate-300 px-4 py-2">
            <div className="text-[11px] font-bold uppercase tracking-widest text-slate-700">New Indent</div>
            <div className="text-[10px] text-slate-500 mt-0.5">Add all items you need in one indent. After saving, open it to attach vendors and request quotes.</div>
          </div>
          <form onSubmit={handleCreate} className="p-4 space-y-3">
            {/* Header — who / why / how urgent — applies to whole indent */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pb-3 border-b border-slate-200">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Department *</label>
                <select required className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>
                  <option value="">Select department</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Requested By</label>
                <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" placeholder="Person name" value={form.requestedByPerson} onChange={e => setForm({ ...form, requestedByPerson: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Urgency</label>
                <select className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })}>
                  {URGENCIES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Category</label>
                <select className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  <optgroup label="Goods">{GOODS_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</optgroup>
                  <optgroup label="Service">{SERVICE_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</optgroup>
                </select>
              </div>
            </div>

            {/* Items table — each row is one item being requested */}
            <div>
              <div className="flex items-center justify-between mb-1">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Items ({lines.filter(l => l.itemName.trim()).length} / {lines.length})</div>
                <button type="button" onClick={addLine} className="px-2 py-0.5 bg-white border border-blue-500 text-blue-700 text-[10px] font-medium hover:bg-blue-50 flex items-center gap-1">
                  <Plus size={10} /> Add Item
                </button>
              </div>
              <div className="border border-slate-300 overflow-visible">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-8">#</th>
                      <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Item *</th>
                      <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Qty *</th>
                      <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Unit</th>
                      <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-28">Est. Rs/unit</th>
                      <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 min-w-[140px]">Remarks</th>
                      <th className="text-center px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest w-20">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const showDropdown = focusedLine === i && (l._itemQuery || l.itemName).length >= 2;
                      const q = (l._itemQuery || l.itemName).toLowerCase();
                      const matches = showDropdown ? invItems.filter(it => it.name.toLowerCase().includes(q) || it.code.toLowerCase().includes(q)).slice(0, 8) : [];
                      return (
                        <tr key={i} className={i % 2 ? 'bg-slate-50/60' : 'bg-white'}>
                          <td className="px-2 py-0.5 text-slate-400 text-center border-r border-slate-100 font-mono tabular-nums">{i + 1}</td>
                          <td className="px-1 py-0.5 border-r border-slate-100 relative">
                            <input className="w-full border-0 px-1.5 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent"
                              placeholder="Type to search or enter new..." value={l._itemQuery ?? l.itemName}
                              onChange={e => updateLine(i, { _itemQuery: e.target.value, itemName: e.target.value, inventoryItemId: '' })}
                              onFocus={() => setFocusedLine(i)}
                              onBlur={() => setTimeout(() => setFocusedLine(f => f === i ? null : f), 200)} />
                            {showDropdown && matches.length > 0 && (
                              <div className="absolute z-20 left-0 right-0 top-full bg-white border border-slate-300 shadow-lg max-h-48 overflow-y-auto">
                                {matches.map(it => (
                                  <div key={it.id} className="px-2 py-1 text-xs hover:bg-blue-50 cursor-pointer border-b border-slate-100 flex justify-between"
                                    onMouseDown={() => {
                                      updateLine(i, {
                                        _itemQuery: it.name, itemName: it.name, inventoryItemId: it.id,
                                        unit: it.unit, estimatedCost: it.costPerUnit > 0 ? String(it.costPerUnit) : l.estimatedCost,
                                      });
                                      setFocusedLine(null);
                                    }}>
                                    <span className="text-slate-800 font-medium">{it.name}</span>
                                    <span className="text-slate-400 text-[10px]">{it.code} | Stock {it.currentStock} {it.unit}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </td>
                          <td className="px-1 py-0.5 border-r border-slate-100">
                            <input type="number" step="any" className="w-full border-0 px-1.5 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent text-right font-mono tabular-nums"
                              value={l.quantity} onChange={e => updateLine(i, { quantity: e.target.value })} />
                          </td>
                          <td className="px-1 py-0.5 border-r border-slate-100">
                            <select className="w-full border-0 px-1 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent" value={l.unit} onChange={e => updateLine(i, { unit: e.target.value })}>
                              <optgroup label="Goods">{GOODS_UNITS.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>
                              <optgroup label="Service">{SERVICE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>
                            </select>
                          </td>
                          <td className="px-1 py-0.5 border-r border-slate-100">
                            <input type="number" step="any" placeholder="optional"
                              className="w-full border-0 px-1.5 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent text-right font-mono tabular-nums"
                              value={l.estimatedCost} onChange={e => updateLine(i, { estimatedCost: e.target.value })} />
                          </td>
                          <td className="px-1 py-0.5 border-r border-slate-100">
                            <input className="w-full border-0 px-1.5 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent" placeholder="spec / model (optional)"
                              value={l.remarks} onChange={e => updateLine(i, { remarks: e.target.value })} />
                          </td>
                          <td className="px-1 py-0.5 text-center">
                            <button type="button" onClick={() => duplicateLine(i)} className="text-slate-400 hover:text-blue-600 mx-0.5" title="Duplicate">⎘</button>
                            <button type="button" onClick={() => removeLine(i)} className="text-slate-400 hover:text-red-600 mx-0.5" title="Delete"><Trash2 size={12} /></button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div className="text-[10px] text-slate-500 mt-1">
                Total items: <span className="font-bold">{lines.filter(l => l.itemName.trim() && parseFloat(l.quantity) > 0).length}</span>
                {' · '}
                Est. total: <span className="font-mono tabular-nums font-bold">Rs.{lines.reduce((s, l) => s + (parseFloat(l.quantity) || 0) * (parseFloat(l.estimatedCost) || 0), 0).toLocaleString('en-IN')}</span>
              </div>
            </div>

            {/* Notes */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Justification</label>
                <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" placeholder="Why is this needed?" value={form.justification} onChange={e => setForm({ ...form, justification: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" placeholder="Any notes for store/purchase" value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} />
              </div>
            </div>

            <div className="flex items-center justify-between pt-1">
              <div className="text-[10px] text-slate-500">After saving, open the indent to attach one or more vendors and request quotes.</div>
              <div className="flex gap-2">
                <button type="button" onClick={() => setTab('list')} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" disabled={saving} className="px-4 py-1 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-wide hover:bg-blue-700 disabled:bg-slate-400">
                  {saving ? 'Saving...' : 'Save Indent'}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* ── LIST ── */}
      {tab === 'list' && (
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white overflow-x-auto">
          {filtered.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400">No indents match the filter</div>
          ) : (
          <table className="w-full text-xs min-w-[1100px]">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-12">Req#</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Date</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Item</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Qty</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Dept</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Person</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Urgency</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-32">Vendor</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-24">Best Rate</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((pr, idx) => {
                const isExpanded = expanded === pr.id;
                const bestQuote = pr.quotes.reduce<Quote | null>((best, q) => (q.vendorRate != null && (!best || (q.vendorRate as number) < (best.vendorRate as number))) ? q : best, null);
                const awardedQuote = pr.quotes.find(q => q.isAwarded);
                const shownVendor = awardedQuote?.vendor.name || pr.vendor?.name || (pr.quotes.length > 0 ? `${pr.quotes.length} quote${pr.quotes.length > 1 ? 's' : ''}` : '—');
                return (
                  <React.Fragment key={pr.id}>
                    <tr
                      className={`border-b border-slate-100 cursor-pointer hover:bg-blue-50/60 ${idx % 2 ? 'bg-slate-50/70' : 'bg-white'} ${isExpanded ? 'bg-blue-50' : ''}`}
                      onClick={() => toggleExpand(pr)}
                    >
                      <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100 font-mono tabular-nums">{pr.reqNo}</td>
                      <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100 text-[10px]">{fmtDate(pr.createdAt)}</td>
                      <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100 truncate max-w-[360px]" title={pr.lines.length > 1 ? pr.lines.map(l => `${l.itemName} (${l.quantity} ${l.unit})`).join(', ') : pr.itemName}>
                        {pr.itemName}
                        {pr.lines.length > 1 && <span className="ml-1 text-[10px] text-blue-600 font-bold">+ {pr.lines.length - 1} more</span>}
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100 text-slate-700">
                        {pr.lines.length > 1
                          ? <span className="text-[10px] text-slate-600 font-bold">{pr.lines.length} items</span>
                          : <>{pr.quantity} <span className="text-[9px] text-slate-400">{pr.unit}</span></>}
                      </td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 text-[10px]">{pr.department || '—'}</td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 text-[10px]">{pr.requestedByPerson || '—'}</td>
                      <td className="px-3 py-1.5 text-center border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${URG_COLORS[pr.urgency]}`}>{pr.urgency}</span>
                      </td>
                      <td className="px-3 py-1.5 text-center border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_COLORS[pr.status]}`}>{pr.status.replace('_', ' ')}</span>
                      </td>
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 text-[10px] truncate max-w-[180px]" title={shownVendor}>
                        <div className="flex items-center gap-1">
                          {awardedQuote && <Award size={10} className="inline text-green-600" />}
                          <span className="flex-1 truncate">{shownVendor}</span>
                          {(awardedQuote?.vendor.id || pr.vendor?.id || (pr.quotes[0]?.vendor.id)) && (
                            <button onClick={e => {
                              e.stopPropagation();
                              const vId = awardedQuote?.vendor.id || pr.vendor?.id || pr.quotes[0]?.vendor.id;
                              const vName = awardedQuote?.vendor.name || pr.vendor?.name || pr.quotes[0]?.vendor.name || 'Vendor';
                              if (!vId) return;
                              setThreadDrawerQuery({ vendorId: vId });
                              setThreadDrawerTitle(`All emails with ${vName}`);
                              setThreadDrawerContext('Across all indents, POs, invoices');
                              setThreadDrawerOnExtract(null);
                            }} title="See all emails with this vendor"
                              className="text-slate-400 hover:text-blue-600 p-0.5 shrink-0">
                              <Inbox size={11} />
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-1.5 text-right font-mono tabular-nums">
                        {bestQuote?.vendorRate != null ? (
                          <span className="text-green-700 font-bold">Rs.{bestQuote.vendorRate.toLocaleString('en-IN')}</span>
                        ) : <span className="text-slate-300">—</span>}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-slate-50">
                        <td colSpan={10} className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="space-y-3">
                    {/* Pipeline */}
                    <div className="bg-white border border-slate-200 p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Pipeline</div>
                        <div className="text-[10px] text-slate-500">Req# {pr.reqNo} · raised by {pr.requestedBy}</div>
                      </div>
                      <div className="flex items-stretch gap-0">
                        {pipelineSteps(pr).map((step, i, arr) => (
                          <React.Fragment key={step.label}>
                            <div className={`flex-1 px-2 py-1 border-l-4 text-center ${
                              step.state === 'done' ? 'border-l-green-500 bg-green-50' :
                              step.state === 'current' ? 'border-l-blue-500 bg-blue-50' :
                              'border-l-slate-300 bg-slate-50'
                            }`}>
                              <div className={`text-[9px] font-bold uppercase tracking-widest ${
                                step.state === 'done' ? 'text-green-700' :
                                step.state === 'current' ? 'text-blue-700' :
                                'text-slate-400'
                              }`}>{step.label}</div>
                              <div className="text-[10px] text-slate-500 font-mono tabular-nums">{step.sub || (step.state === 'done' ? '✓' : step.state === 'current' ? '…' : '')}</div>
                            </div>
                            {i < arr.length - 1 && <div className={`w-1 ${step.state === 'done' ? 'bg-green-400' : 'bg-slate-200'}`} />}
                          </React.Fragment>
                        ))}
                      </div>
                    </div>

                    {/* ── ITEMS in this indent ── */}
                    <div className="bg-white border border-slate-200">
                      <div className="bg-slate-100 border-b border-slate-200 px-3 py-1.5 flex items-center justify-between">
                        <div className="text-[10px] font-bold text-slate-700 uppercase tracking-widest">
                          Items in this Indent ({pr.lines.length || 1})
                        </div>
                        <div className="text-[10px] text-slate-500">
                          Est. total: Rs.{pr.lines.reduce((s, l) => s + (l.quantity * l.estimatedCost), 0).toLocaleString('en-IN') || '0'}
                        </div>
                      </div>
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                            <th className="text-left px-3 py-1 font-semibold text-[10px] uppercase tracking-widest w-8">#</th>
                            <th className="text-left px-3 py-1 font-semibold text-[10px] uppercase tracking-widest">Item</th>
                            <th className="text-right px-3 py-1 font-semibold text-[10px] uppercase tracking-widest w-20">Qty</th>
                            <th className="text-left px-3 py-1 font-semibold text-[10px] uppercase tracking-widest w-20">Unit</th>
                            <th className="text-right px-3 py-1 font-semibold text-[10px] uppercase tracking-widest w-24">Est. Rs/unit</th>
                            <th className="text-right px-3 py-1 font-semibold text-[10px] uppercase tracking-widest w-24">Line Total</th>
                            <th className="text-left px-3 py-1 font-semibold text-[10px] uppercase tracking-widest">Remarks</th>
                            <th className="text-left px-3 py-1 font-semibold text-[10px] uppercase tracking-widest w-20">Stock</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(pr.lines.length > 0 ? pr.lines : [{ id: pr.id, lineNo: 1, itemName: pr.itemName, quantity: pr.quantity, unit: pr.unit, estimatedCost: pr.estimatedCost, inventoryItemId: pr.inventoryItemId, remarks: null, inventoryItem: null } as IndentLine]).map(l => (
                            <tr key={l.id} className="border-b border-slate-100 last:border-b-0">
                              <td className="px-3 py-1 text-slate-400 font-mono tabular-nums">{l.lineNo}</td>
                              <td className="px-3 py-1 text-slate-800 font-medium">{l.itemName}</td>
                              <td className="px-3 py-1 text-right font-mono tabular-nums">{l.quantity}</td>
                              <td className="px-3 py-1 text-slate-600">{l.unit}</td>
                              <td className="px-3 py-1 text-right font-mono tabular-nums">{l.estimatedCost > 0 ? l.estimatedCost.toLocaleString('en-IN') : '—'}</td>
                              <td className="px-3 py-1 text-right font-mono tabular-nums font-bold text-slate-800">{l.estimatedCost > 0 ? `Rs.${(l.quantity * l.estimatedCost).toLocaleString('en-IN')}` : '—'}</td>
                              <td className="px-3 py-1 text-[10px] text-slate-500 italic">{l.remarks || '—'}</td>
                              <td className="px-3 py-1 text-[10px]">
                                {l.inventoryItem ? (
                                  <span className={l.inventoryItem.currentStock >= l.quantity ? 'text-green-700 font-bold' : l.inventoryItem.currentStock > 0 ? 'text-amber-600 font-bold' : 'text-red-600 font-bold'}>
                                    {l.inventoryItem.currentStock} {l.inventoryItem.unit}
                                  </span>
                                ) : <span className="text-slate-300">—</span>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
                      {/* ── LEFT: Request Info ── */}
                      <div className="bg-white border border-slate-200 p-3 space-y-2">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Request Info</div>
                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                          <div><div className="text-[9px] text-slate-400 uppercase">Dept</div><div className="font-medium text-slate-800">{pr.department || '—'}</div></div>
                          <div><div className="text-[9px] text-slate-400 uppercase">Person</div><div className="font-medium text-slate-800">{pr.requestedByPerson || '—'}</div></div>
                          <div><div className="text-[9px] text-slate-400 uppercase">Category</div><div className="font-medium text-slate-800">{pr.category.replace(/_/g, ' ')}</div></div>
                          <div><div className="text-[9px] text-slate-400 uppercase">Raised By</div><div className="font-medium text-slate-800">{pr.requestedBy}</div></div>
                        </div>
                        {pr.justification && <div className="text-[11px] pt-1 border-t border-slate-100"><span className="text-[9px] text-slate-400 uppercase">Why:</span> <span className="text-slate-700">{pr.justification}</span></div>}
                        {pr.remarks && <div className="text-[11px] text-slate-600 italic">{pr.remarks}</div>}
                        {pr.rejectionReason && <div className="text-[11px] text-red-700 pt-1 border-t border-slate-100"><span className="text-[9px] text-slate-400 uppercase">Rejected:</span> {pr.rejectionReason}</div>}
                      </div>

                      {/* ── MIDDLE: Store Actions (goods) / Procurement Actions (service) ── */}
                      <div className="bg-white border border-slate-200 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">
                            {pr.inventoryItemId ? 'Store Actions' : 'Procurement Actions'}
                          </div>
                          {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(pr.status) && (
                            <button onClick={() => { setRejectingId(pr.id); setRejectReason(''); }} className="px-2 py-0.5 bg-white border border-red-300 text-red-600 text-[10px] font-medium hover:bg-red-50">Reject</button>
                          )}
                        </div>
                        {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(pr.status) && (
                          <>
                            {pr.inventoryItemId && stockCheck?.id === pr.id ? (
                              <div className="space-y-2">
                                <div className="flex items-center gap-4 text-[11px]">
                                  <div><div className="text-[9px] text-slate-400 uppercase">On hand</div><div className={`font-bold font-mono tabular-nums ${stockCheck.available > 0 ? 'text-green-700' : 'text-red-600'}`}>{stockCheck.available} {stockCheck.unit}</div></div>
                                  <div><div className="text-[9px] text-slate-400 uppercase">Needed</div><div className="font-bold font-mono tabular-nums">{stockCheck.requested} {stockCheck.unit}</div></div>
                                  <div><div className="text-[9px] text-slate-400 uppercase">Verdict</div>
                                    {stockCheck.available >= stockCheck.requested ? <div className="font-bold text-green-700 text-[11px]">In Stock</div> :
                                     stockCheck.available > 0 ? <div className="font-bold text-amber-600 text-[11px]">Partial</div> :
                                     <div className="font-bold text-red-600 text-[11px]">None</div>}
                                  </div>
                                </div>
                                <div className="flex items-end gap-2">
                                  <div>
                                    <label className="text-[9px] text-slate-400 uppercase">Issue Qty</label>
                                    <input type="number" min={0} max={Math.min(stockCheck.available, stockCheck.requested)} value={issueQty}
                                      onChange={e => setIssueQty(String(Math.max(0, Math.min(Number(e.target.value), Math.min(stockCheck.available, stockCheck.requested)))))}
                                      className="border border-slate-300 px-2 py-1 text-xs w-24 font-mono tabular-nums" />
                                  </div>
                                  <div className="flex gap-1">
                                    <button onClick={() => handleIssue(pr.id)} disabled={actionLoading} className="px-2 py-1 bg-green-600 text-white text-[10px] font-medium hover:bg-green-700 disabled:opacity-50">
                                      {pr.status !== 'APPROVED' ? 'Approve & Issue' : 'Issue'}
                                    </button>
                                    <button onClick={() => handleFullPurchase(pr.id)} disabled={actionLoading} className="px-2 py-1 bg-purple-600 text-white text-[10px] font-medium hover:bg-purple-700 disabled:opacity-50">
                                      Full Purchase
                                    </button>
                                  </div>
                                </div>
                              </div>
                            ) : pr.inventoryItemId ? (
                              <div className="text-[11px] text-slate-400">Checking stock…</div>
                            ) : (
                              <div className="flex justify-end">
                                <button onClick={() => handleFullPurchase(pr.id)} disabled={actionLoading} className="px-2 py-1 bg-purple-600 text-white text-[10px] font-medium hover:bg-purple-700 disabled:opacity-50">
                                  {pr.status !== 'APPROVED' ? 'Approve & Request Quote' : 'Send to Purchase'}
                                </button>
                              </div>
                            )}
                          </>
                        )}
                        {pr.status === 'PO_PENDING' && (
                          <div className="flex flex-col gap-2">
                            <div className="text-[11px] text-amber-700">{pr.purchaseQty} {pr.unit} pending purchase {pr.vendor ? `from ${pr.vendor.name}` : ''}</div>
                            <div className="flex gap-1">
                              <a href={`/procurement/purchase-orders?newPO=1&item=${encodeURIComponent(pr.itemName)}&qty=${pr.purchaseQty}&unit=${encodeURIComponent(pr.unit)}&requisitionId=${pr.id}`} className="px-2 py-1 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">Create PO</a>
                              <button onClick={() => updateStatus(pr.id, 'ORDERED')} className="px-2 py-1 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50">Mark Ordered</button>
                            </div>
                          </div>
                        )}
                        {/* Auto-PO created on award — show next-step navigation */}
                        {pr.purchaseOrders && pr.purchaseOrders.length > 0 && (
                          <div className="border-t border-slate-200 pt-2 mt-2 space-y-1.5">
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Linked PO</div>
                            {pr.purchaseOrders.map(po => {
                              const isPaid = ['PAID'].includes(po.status);
                              const isReceivable = ['APPROVED', 'SENT', 'PARTIAL_RECEIVED'].includes(po.status);
                              const isReceived = ['RECEIVED', 'PARTIAL_RECEIVED'].includes(po.status);
                              // Friendly status caption
                              const statusCaption: Record<string, { label: string; tone: string }> = {
                                DRAFT: { label: 'Waiting for confirmation', tone: 'border-amber-400 bg-amber-50 text-amber-800' },
                                APPROVED: { label: 'Approved — Send to vendor / Receive goods', tone: 'border-blue-400 bg-blue-50 text-blue-800' },
                                SENT: { label: 'Sent to vendor — Awaiting goods', tone: 'border-blue-400 bg-blue-50 text-blue-800' },
                                PARTIAL_RECEIVED: { label: 'Partial goods received', tone: 'border-amber-400 bg-amber-50 text-amber-800' },
                                RECEIVED: { label: 'Goods received — Awaiting invoice', tone: 'border-green-400 bg-green-50 text-green-800' },
                                CLOSED: { label: 'Closed', tone: 'border-slate-400 bg-slate-50 text-slate-700' },
                                CANCELLED: { label: 'Cancelled', tone: 'border-red-400 bg-red-50 text-red-700' },
                                PAID: { label: 'Paid', tone: 'border-green-400 bg-green-50 text-green-800' },
                              };
                              const cap = statusCaption[po.status] ?? { label: po.status, tone: 'border-slate-400 bg-slate-50 text-slate-700' };
                              return (
                                <div key={po.id} className="bg-blue-50 border border-blue-200 px-2.5 py-1.5 space-y-1">
                                  <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[11px] font-bold text-blue-800">PO #{po.poNo}</span>
                                    <span className="text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 border border-blue-400 bg-white text-blue-700">{po.status}</span>
                                    <span className={`text-[10px] font-medium px-1.5 py-0.5 border ${cap.tone}`}>{cap.label}</span>
                                    <span className="text-[10px] text-slate-600 font-mono ml-auto">₹{po.grandTotal.toLocaleString('en-IN')}</span>
                                  </div>
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <a href={`/procurement/purchase-orders?expand=${po.id}`}
                                      className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">Open PO</a>
                                    {po.status === 'DRAFT' && (
                                      <a href="/store/receipts?tab=pos"
                                        title="Confirm or cancel this draft PO from Store Receipts"
                                        className="px-2 py-0.5 bg-amber-600 text-white text-[10px] font-medium hover:bg-amber-700">
                                        Review in Store Receipts →
                                      </a>
                                    )}
                                    {isReceivable && (
                                      <a href={`/store/receipts?poId=${po.id}`}
                                        className="px-2 py-0.5 bg-amber-600 text-white text-[10px] font-medium hover:bg-amber-700"
                                        title="Create / update GRN — partial GRN keeps it 'awaiting material'">
                                        Receive Goods (GRN)
                                      </a>
                                    )}
                                    {isReceived && pr.vendorId && (
                                      <a href={`/accounts/payments-out/reconcile/${pr.vendorId}?upload=1&poId=${po.id}`}
                                        className="px-2 py-0.5 bg-green-600 text-white text-[10px] font-medium hover:bg-green-700"
                                        title="Upload the vendor's tax invoice for this PO">
                                        Upload Invoice
                                      </a>
                                    )}
                                    {isPaid && (
                                      <span className="text-[10px] text-green-700 font-bold px-2">✓ Paid</span>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        {pr.status === 'ORDERED' && (
                          <button onClick={() => updateStatus(pr.id, 'RECEIVED')} className="px-2 py-1 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">Mark Received</button>
                        )}
                        {pr.status === 'REJECTED' && (
                          <button onClick={() => updateStatus(pr.id, 'DRAFT')} className="px-2 py-1 border border-slate-400 bg-white text-slate-700 text-[10px] font-medium hover:bg-slate-100">Resubmit as Draft</button>
                        )}
                        {(pr.status === 'RECEIVED' || pr.status === 'PARTIAL_RECEIVED') && (() => {
                          const remaining = Math.max(0, Math.round((pr.quantity - pr.issuedQty) * 1000) / 1000);
                          return (
                            <div className="border border-teal-300 bg-teal-50/40 p-2 space-y-2">
                              <div className="text-[10px] font-bold text-teal-700 uppercase tracking-widest">Material in Store — Issue to Requester</div>
                              <div className="grid grid-cols-3 gap-2 text-[10px]">
                                <div><span className="text-slate-400 uppercase block">Total</span><span className="font-mono tabular-nums font-bold text-slate-800">{pr.quantity} {pr.unit}</span></div>
                                <div><span className="text-slate-400 uppercase block">Issued</span><span className="font-mono tabular-nums font-bold text-slate-800">{pr.issuedQty} {pr.unit}</span></div>
                                <div><span className="text-slate-400 uppercase block">Remaining</span><span className={`font-mono tabular-nums font-bold ${remaining > 0 ? 'text-teal-700' : 'text-slate-500'}`}>{remaining} {pr.unit}</span></div>
                              </div>
                              {remaining > 0 ? (
                                <div className="flex items-end gap-2">
                                  <div>
                                    <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest block">Issue now to {pr.requestedByPerson || pr.requestedBy}</label>
                                    <input type="number" min={0} max={remaining} step={0.01}
                                      value={issueToReqQty}
                                      onChange={(e) => setIssueToReqQty(e.target.value)}
                                      className="border border-slate-300 px-2 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-slate-400 w-24 font-mono tabular-nums" />
                                  </div>
                                  <button onClick={() => handleIssueToRequester(pr.id)} disabled={actionLoading || !parseFloat(issueToReqQty)}
                                    className="px-2 py-1 bg-teal-600 text-white text-[10px] font-medium hover:bg-teal-700 disabled:opacity-50">
                                    Issue to Requester
                                  </button>
                                </div>
                              ) : (
                                <div className="text-[10px] text-slate-500">All issued. Waiting for completion.</div>
                              )}
                              {pr.issuedAt && (
                                <div className="text-[9px] text-slate-500">Last issue: {fmtDate(pr.issuedAt)} {pr.issuedBy ? `by ${pr.issuedBy}` : ''}</div>
                              )}
                            </div>
                          );
                        })()}
                        {pr.status === 'COMPLETED' && (
                          <div className="text-[11px] text-slate-600 space-y-0.5">
                            {pr.issuedBy && <div><span className="text-[9px] text-slate-400 uppercase">Issued by:</span> {pr.issuedBy}</div>}
                            {pr.issuedAt && <div><span className="text-[9px] text-slate-400 uppercase">Issued:</span> {fmtDate(pr.issuedAt)}</div>}
                            {pr.approvedBy && <div><span className="text-[9px] text-slate-400 uppercase">Approved by:</span> {pr.approvedBy}</div>}
                          </div>
                        )}
                      </div>

                      {/* ── RIGHT: Item History ── */}
                      <div className="bg-white border border-slate-200 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Past Orders</div>
                          {itemHistory?.stats && (
                            <div className="text-[9px] text-slate-500">
                              {itemHistory.stats.totalPos} POs · Last Rs.{itemHistory.stats.lastRate.toLocaleString('en-IN')}
                            </div>
                          )}
                        </div>
                        {!pr.inventoryItemId ? (
                          <div className="text-[11px] text-slate-400 italic">No item linked — history N/A</div>
                        ) : historyLoading ? (
                          <div className="text-[11px] text-slate-400">Loading…</div>
                        ) : !itemHistory || itemHistory.recent.length === 0 ? (
                          <div className="text-[11px] text-slate-400 italic">No prior POs for this item</div>
                        ) : (
                          <>
                            {itemHistory.stats && (
                              <div className="text-[10px] text-slate-600 grid grid-cols-3 gap-1 p-2 bg-slate-50 border border-slate-100">
                                <div>Min <span className="font-bold font-mono">Rs.{itemHistory.stats.minRate.toLocaleString('en-IN')}</span></div>
                                <div>Avg <span className="font-bold font-mono">Rs.{itemHistory.stats.avgRate.toLocaleString('en-IN')}</span></div>
                                <div>Max <span className="font-bold font-mono">Rs.{itemHistory.stats.maxRate.toLocaleString('en-IN')}</span></div>
                              </div>
                            )}
                            <div className="max-h-40 overflow-y-auto">
                              <table className="w-full text-[10px]">
                                <thead>
                                  <tr className="text-slate-500 border-b border-slate-200">
                                    <th className="text-left py-1 px-1">PO#</th>
                                    <th className="text-left py-1 px-1">Vendor</th>
                                    <th className="text-right py-1 px-1">Rate</th>
                                    <th className="text-left py-1 px-1">Date</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {itemHistory.recent.map((h, i) => (
                                    <tr key={i} className="border-b border-slate-100">
                                      <td className="py-1 px-1 font-mono tabular-nums text-slate-700">{h.poNo}</td>
                                      <td className="py-1 px-1 text-slate-800 truncate max-w-[100px]" title={h.vendorName || ''}>{h.vendorName || '—'}</td>
                                      <td className="py-1 px-1 text-right font-mono tabular-nums font-bold">{h.rate.toLocaleString('en-IN')}</td>
                                      <td className="py-1 px-1 text-[9px] text-slate-500">{h.poDate ? new Date(h.poDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </>
                        )}
                      </div>
                    </div>

                    {/* ── VENDOR QUOTE TABLE — each row is one vendor ── */}
                    <div className="bg-white border border-slate-200">
                      <div className="bg-slate-100 border-b border-slate-200 px-3 py-2 flex items-center justify-between">
                        <div>
                          <div className="text-[11px] font-bold text-slate-700 uppercase tracking-widest">Vendor Quotes — each row = one vendor</div>
                          <div className="text-[10px] text-slate-500">Add multiple vendors to compare rates. Click "Award" once you've picked the winner.</div>
                        </div>
                        <button onClick={() => { setVendorPickFor(pr.id); setVendorQuery(''); }}
                          className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1">
                          <Plus size={12} /> Add Vendor
                        </button>
                      </div>
                      <table className="w-full text-[11px]">
                        <thead>
                          <tr className="bg-slate-50 border-b border-slate-200 text-slate-600">
                            <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Vendor</th>
                            <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Contact</th>
                            <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Status</th>
                            <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Rate (Rs)</th>
                            <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Total (Rs)</th>
                            <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Source</th>
                            <th className="text-center px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {pr.quotes.length === 0 && (
                            <tr><td colSpan={7} className="px-3 py-6 text-center text-[11px] text-slate-400 italic">No vendors added yet — click "Add Vendor" to request quotes</td></tr>
                          )}
                          {pr.quotes.map(q => {
                            const total = q.vendorRate ? q.vendorRate * pr.quantity : 0;
                            const lineCount = pr.lines.length;
                            const pricedCount = q.pricedLineCount ?? 0;
                            const panelOpen = lineRatesPanelFor === q.id;
                            const inputs = lineRateInputs[q.id] || [];
                            const stage = q.isAwarded ? 'AWARDED'
                              : pricedCount > 0 && pricedCount === lineCount ? 'ALL ITEMS PRICED'
                              : pricedCount > 0 ? `${pricedCount} OF ${lineCount} PRICED`
                              : q.quoteRequestedAt ? 'WAITING FOR RATES'
                              : 'PENDING RFQ';
                            const stageStyle: Record<string, string> = {
                              'PENDING RFQ': 'border-slate-400 bg-slate-50 text-slate-600',
                              'WAITING FOR RATES': 'border-amber-500 bg-amber-50 text-amber-700',
                              'ALL ITEMS PRICED': 'border-blue-500 bg-blue-50 text-blue-700',
                              'AWARDED': 'border-green-600 bg-green-50 text-green-700',
                            };
                            const stageClass = stageStyle[stage] || 'border-amber-500 bg-amber-50 text-amber-700';
                            return (
                              <React.Fragment key={q.id}>
                              <tr className={`border-b border-slate-100 ${q.isAwarded ? 'bg-green-50' : ''}`}>
                                <td className="px-3 py-1.5">
                                  <div className="flex items-center gap-1">
                                    {q.isAwarded && <Award size={12} className="text-green-600" />}
                                    <span className="font-bold text-slate-800">{q.vendor.name}</span>
                                  </div>
                                </td>
                                <td className="px-3 py-1.5 text-slate-500 text-[10px]">
                                  {q.vendor.email || <span className="italic">no email</span>}
                                  {q.vendor.phone && <div>{q.vendor.phone}</div>}
                                </td>
                                <td className="px-3 py-1.5 text-[10px]">
                                  <div className="space-y-0.5">
                                    <span className={`inline-block text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 border ${stageClass}`}>{stage}</span>
                                    {q.quoteRequestedAt && (
                                      <div className="text-slate-500">
                                        <span className="text-slate-400">Sent </span>{fmtDate(q.quoteRequestedAt)}
                                        {q.quoteRequestedBy && <span className="text-[9px] text-slate-400"> · {q.quoteRequestedBy}</span>}
                                      </div>
                                    )}
                                    {q.quotedAt && q.vendorRate != null && (
                                      <div className="text-slate-500"><span className="text-slate-400">Replied </span>{fmtDate(q.quotedAt)}</div>
                                    )}
                                  </div>
                                </td>
                                <td className="px-3 py-1.5 text-right">
                                  {q.vendorRate != null ? (
                                    <div>
                                      <div className="font-bold text-green-700 font-mono tabular-nums">{q.vendorRate.toLocaleString('en-IN')}</div>
                                      {lineCount > 1 && <div className="text-[9px] text-slate-400 italic">avg of {pricedCount} items</div>}
                                    </div>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800">
                                  {total > 0 ? total.toLocaleString('en-IN') : '—'}
                                </td>
                                <td className="px-3 py-1.5 text-[10px] text-slate-500">
                                  {(() => {
                                    const src = q.quoteSource;
                                    if (!src) return <span className="italic">—</span>;
                                    const label: Record<string, string> = {
                                      EMAIL_AUTO: 'AI', EMAIL_PARTIAL: 'AI (partial)', EMAIL_AUTO_LOW: 'AI · LOW',
                                      MANUAL: 'MANUAL', MIXED: 'MIXED', PHONE: 'PHONE', WHATSAPP: 'WHATSAPP',
                                    };
                                    if (src === 'EMAIL_AUTO_LOW') {
                                      return <span title="AI extracted these but flagged the read as LOW confidence — verify before award" className="inline-block text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 border border-amber-500 bg-amber-50 text-amber-800">AI · LOW</span>;
                                    }
                                    return <span className="font-bold text-slate-700">{label[src] || src}</span>;
                                  })()}
                                  {q.quoteRemarks && <div className="text-[9px] italic truncate max-w-[120px]" title={q.quoteRemarks}>{q.quoteRemarks}</div>}
                                </td>
                                <td className="px-3 py-1.5 text-center">
                                  <div className="flex items-center justify-center gap-1 flex-wrap">
                                    <button onClick={() => toggleLineRatesPanel(pr.id, q.id)}
                                      title="Enter / view item-wise rates"
                                      className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide flex items-center gap-1 ${panelOpen ? 'bg-blue-600 text-white' : 'bg-white border border-blue-500 text-blue-600 hover:bg-blue-50'}`}>
                                      {panelOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />} Item-wise Rates
                                    </button>
                                    <button
                                      onClick={() => {
                                        const prId = pr.id;
                                        const vrId = q.id;
                                        setThreadDrawerQuery({ entityType: 'INDENT_QUOTE', entityId: vrId });
                                        setThreadDrawerTitle(`Thread — ${q.vendor.name}`);
                                        setThreadDrawerContext(`Indent #${pr.reqNo} · ${q.vendor.email || 'no email'}`);
                                        setThreadDrawerOnExtract(() => async (_tId: string, _rId: string) => {
                                          if (!confirmOverwriteIfNeeded(q)) return;
                                          await api.post(`/purchase-requisition/${prId}/vendors/${vrId}/extract-quote`, { autoApply: true }, { timeout: 120000 });
                                          load();
                                          if (lineRatesPanelFor === vrId) loadLineRates(prId, vrId);
                                        });
                                        setThreadDrawerEmptyAction({
                                          label: 'Send RFQ Email Now',
                                          remarksLabel: 'Special Remarks for this RFQ (added to PDF + email body, optional)',
                                          previewUrl: `/purchase-requisition/${prId}/vendors/${vrId}/rfq-pdf`,
                                          onClick: async (remarks?: string) => {
                                            try {
                                              await api.post(`/purchase-requisition/${prId}/vendors/${vrId}/send-rfq`, {
                                                extraMessage: remarks || undefined,
                                              });
                                              setThreadDrawerQuery(null);
                                              setTimeout(() => setThreadDrawerQuery({ entityType: 'INDENT_QUOTE', entityId: vrId }), 200);
                                              load();
                                            } catch (e: unknown) {
                                              alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Send failed');
                                            }
                                          },
                                        });
                                      }}
                                      title={q.quoteRequestedAt ? 'Email thread + replies' : 'Send RFQ & track replies'}
                                      className={`p-0.5 ${q.quoteRequestedAt ? 'text-green-600 hover:text-green-800' : 'text-blue-600 hover:text-blue-800'}`}>
                                      <Mail size={14} />
                                    </button>
                                    <button onClick={() => openRfqDrawer(pr.id, q)} title="Preview RFQ PDF before sending"
                                      className="p-0.5 text-slate-400 hover:text-slate-700">
                                      <FileText size={12} />
                                    </button>
                                    {q.vendorRate != null && !q.isAwarded && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(pr.status) && (
                                      <button onClick={() => handleAward(pr.id, q.id)} title="Award this vendor"
                                        className="px-1.5 py-0.5 bg-green-600 text-white text-[10px] font-medium hover:bg-green-700 flex items-center gap-0.5">
                                        <Award size={10} /> Award
                                      </button>
                                    )}
                                    {!q.isAwarded && (
                                      <button onClick={() => handleDeleteQuote(pr.id, q.id)} title="Remove vendor" className="text-slate-400 hover:text-red-600 p-0.5">
                                        <Trash2 size={12} />
                                      </button>
                                    )}
                                  </div>
                                </td>
                              </tr>
                              {/* Item-wise rate-entry panel — sub-row beneath the vendor row */}
                              {panelOpen && (
                                <tr className="bg-slate-50">
                                  <td colSpan={7} className="px-3 py-3">
                                    <div className="border border-slate-300 bg-white">
                                      <div className="bg-slate-100 border-b border-slate-300 px-3 py-2 flex items-center justify-between flex-wrap gap-2">
                                        <div className="text-[10px] font-bold text-slate-700 uppercase tracking-widest">
                                          Item-wise Rates from {q.vendor.name}
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {q.quoteRequestedAt && (
                                            <button onClick={() => extractAIToLines(pr.id, q.id)}
                                              disabled={lineRatesExtracting[q.id]}
                                              title="Read the latest email reply + attached PDF and try to fill rates automatically"
                                              className="px-2 py-1 bg-purple-600 text-white text-[10px] font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
                                              <Sparkles size={10} />
                                              {lineRatesExtracting[q.id] ? 'AI reading email + PDF…' : 'AI Extract from Email/PDF'}
                                            </button>
                                          )}
                                          <button onClick={() => loadLineRates(pr.id, q.id)} disabled={lineRatesLoading[q.id]}
                                            title="Reload saved rates"
                                            className="px-2 py-1 bg-white border border-slate-400 text-slate-700 text-[10px] font-medium hover:bg-slate-100 disabled:opacity-50 flex items-center gap-1">
                                            <RefreshCw size={10} className={lineRatesLoading[q.id] ? 'animate-spin' : ''} /> Reload
                                          </button>
                                        </div>
                                      </div>
                                      {/* Bulk-apply overall discount — for footer-level discounts (e.g. "Discount - 31%" on Gajanan-style quotes). */}
                                      <div className="bg-emerald-50/60 border-b border-emerald-200 px-3 py-2 flex items-center gap-2 flex-wrap">
                                        <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest">Overall Discount</span>
                                        <input type="number" step="any" inputMode="decimal" placeholder="e.g. 31" min="0" max="100"
                                          value={bulkDiscountInput[q.id] || ''}
                                          onChange={e => setBulkDiscountInput(prev => ({ ...prev, [q.id]: e.target.value }))}
                                          className="border border-slate-300 px-2 py-1 text-xs w-20 font-mono tabular-nums text-right focus:outline-none focus:ring-1 focus:ring-emerald-500" />
                                        <span className="text-[11px] text-slate-600">%</span>
                                        <button onClick={() => applyBulkDiscount(q.id)}
                                          disabled={!(bulkDiscountInput[q.id] || '').trim()}
                                          title="Set this discount % on every line below. You can still edit individual lines after."
                                          className="px-2 py-1 bg-emerald-600 text-white text-[10px] font-bold uppercase tracking-wide hover:bg-emerald-700 disabled:bg-slate-300 disabled:text-slate-500">
                                          Apply to all lines
                                        </button>
                                        <span className="text-[10px] text-slate-500 ml-1">Use this for footer-level / negotiated discounts before sending to PO. Click Save Rates to persist.</span>
                                      </div>
                                      {lineRatesError[q.id] && (
                                        <div className="bg-amber-50 border-b border-amber-200 px-3 py-2 text-[11px] text-amber-800 flex items-start gap-1.5">
                                          <AlertCircle size={12} className="mt-0.5 shrink-0" /> {lineRatesError[q.id]}
                                        </div>
                                      )}
                                      {aiDiagnostics[q.id] && (
                                        <div className="bg-purple-50/60 border-b border-purple-200 px-3 py-2 text-[11px]">
                                          <div className="text-[10px] font-bold text-purple-800 uppercase tracking-widest mb-1.5 flex items-center gap-1">
                                            <Sparkles size={10} /> What AI saw (confidence: {aiDiagnostics[q.id]!.confidence})
                                          </div>
                                          {aiDiagnostics[q.id]!.overallRateNote && (
                                            <div className="text-slate-700 mb-1"><span className="font-bold">Overall:</span> {aiDiagnostics[q.id]!.overallRateNote}</div>
                                          )}
                                          {aiDiagnostics[q.id]!.extractedTotal != null && aiDiagnostics[q.id]!.extractedTotal! > 0 && (
                                            <div className="text-slate-700 mb-1"><span className="font-bold">Extracted total:</span> ₹{aiDiagnostics[q.id]!.extractedTotal!.toLocaleString('en-IN')}</div>
                                          )}
                                          {aiDiagnostics[q.id]!.matched.length === 0 ? (
                                            <div className="text-slate-600 italic">AI returned no line items.{aiDiagnostics[q.id]!.notes ? ` Notes: ${aiDiagnostics[q.id]!.notes}` : ''}</div>
                                          ) : (
                                            <div className="overflow-x-auto">
                                              <table className="w-full text-[10px] border border-purple-200">
                                                <thead className="bg-purple-100/60">
                                                  <tr>
                                                    <th className="px-2 py-1 text-left font-bold text-slate-700">AI item name</th>
                                                    <th className="px-2 py-1 text-right font-bold text-slate-700">AI rate</th>
                                                    <th className="px-2 py-1 text-left font-bold text-slate-700">Matched indent line</th>
                                                    <th className="px-2 py-1 text-left font-bold text-slate-700">Match by</th>
                                                  </tr>
                                                </thead>
                                                <tbody>
                                                  {aiDiagnostics[q.id]!.matched.map((m, mi) => (
                                                    <tr key={mi} className="border-t border-purple-100">
                                                      <td className="px-2 py-1 text-slate-800">{m.aiName || <span className="text-slate-400 italic">(no name)</span>}</td>
                                                      <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-800">{m.aiUnitRate ? `₹${m.aiUnitRate.toLocaleString('en-IN')}` : '—'}</td>
                                                      <td className="px-2 py-1 text-slate-700">{m.matched || <span className="text-red-600 font-bold">no match</span>}</td>
                                                      <td className="px-2 py-1 text-slate-500">{m.strategy || <span className="text-red-500">—</span>}</td>
                                                    </tr>
                                                  ))}
                                                </tbody>
                                              </table>
                                            </div>
                                          )}
                                          {aiDiagnostics[q.id]!.indentLineNames.length > 0 && (
                                            <div className="text-[10px] text-slate-600 mt-1.5">
                                              <span className="font-bold">Your indent lines:</span> {aiDiagnostics[q.id]!.indentLineNames.join(' · ')}
                                            </div>
                                          )}
                                        </div>
                                      )}
                                      {/* Editable vendor terms (payment / delivery / freight) — was read-only before. */}
                                      <div className="bg-blue-50 border-b border-blue-200 px-3 py-2">
                                        <div className="text-[9px] font-bold text-blue-700 uppercase tracking-widest mb-1 flex items-center justify-between">
                                          <span>Vendor Terms — payment, delivery, freight (edit before award)</span>
                                          <button onClick={() => saveQuoteRemarks(pr.id, q.id)}
                                            disabled={remarksSaving[q.id] || (remarksDraft[q.id] === undefined)}
                                            className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-bold uppercase tracking-wide hover:bg-blue-700 disabled:bg-slate-300 disabled:text-slate-500">
                                            {remarksSaving[q.id] ? 'Saving…' : 'Save Terms'}
                                          </button>
                                        </div>
                                        <textarea
                                          value={remarksDraft[q.id] ?? q.quoteRemarks ?? ''}
                                          onChange={e => setRemarksDraft(prev => ({ ...prev, [q.id]: e.target.value }))}
                                          placeholder="e.g. Payment: 50% advance, 50% on delivery · Delivery: 7 days · Freight: FOR site"
                                          rows={2}
                                          className="w-full border border-blue-200 bg-white px-2 py-1 text-[12px] text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                      </div>
                                      {/* Cost components — structured promotions of the cost-affecting numbers */}
                                      {(() => {
                                        const d = ensureCostDraft(q);
                                        const chargeRow = (label: string, pctKey: keyof CostDraft, amtKey: keyof CostDraft) => (
                                          <div className="flex items-center gap-2 text-[11px]">
                                            <span className="text-slate-600 w-20">{label}</span>
                                            <input type="number" step="any" inputMode="decimal" placeholder="%"
                                              value={d[pctKey] as string}
                                              onChange={e => updateCostDraft(q, { [pctKey]: e.target.value } as Partial<CostDraft>)}
                                              className="border border-slate-300 px-1.5 py-1 w-16 font-mono tabular-nums text-right focus:outline-none focus:ring-1 focus:ring-amber-500" />
                                            <span className="text-slate-400 text-[10px]">%</span>
                                            <span className="text-slate-400 text-[10px]">or</span>
                                            <input type="number" step="any" inputMode="decimal" placeholder="₹"
                                              value={d[amtKey] as string}
                                              onChange={e => updateCostDraft(q, { [amtKey]: e.target.value } as Partial<CostDraft>)}
                                              className="border border-slate-300 px-1.5 py-1 w-24 font-mono tabular-nums text-right focus:outline-none focus:ring-1 focus:ring-amber-500" />
                                          </div>
                                        );
                                        return (
                                          <div className="bg-amber-50/60 border-b border-amber-200 px-3 py-2">
                                            <div className="text-[9px] font-bold text-amber-800 uppercase tracking-widest mb-2 flex items-center justify-between">
                                              <span>Cost Components — flow to PO header on award</span>
                                              <button onClick={() => saveCostComponents(pr.id, q)}
                                                disabled={costSaving[q.id]}
                                                className="px-2 py-0.5 bg-amber-600 text-white text-[9px] font-bold uppercase tracking-wide hover:bg-amber-700 disabled:bg-slate-300 disabled:text-slate-500">
                                                {costSaving[q.id] ? 'Saving…' : 'Save Cost'}
                                              </button>
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1.5">
                                              {chargeRow('Packing', 'packingPercent', 'packingAmount')}
                                              {chargeRow('Freight', 'freightPercent', 'freightAmount')}
                                              {chargeRow('Insurance', 'insurancePercent', 'insuranceAmount')}
                                              {chargeRow('Loading', 'loadingPercent', 'loadingAmount')}
                                            </div>
                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-1.5 mt-2 pt-2 border-t border-amber-200/70 text-[11px]">
                                              <label className="flex items-center gap-2">
                                                <input type="checkbox"
                                                  checked={d.isRateInclusiveOfGst}
                                                  onChange={e => updateCostDraft(q, { isRateInclusiveOfGst: e.target.checked })} />
                                                <span className="text-slate-700">Rate is GST-inclusive</span>
                                              </label>
                                              <div className="flex items-center gap-2">
                                                <span className="text-slate-600 w-20">TCS</span>
                                                <input type="number" step="any" inputMode="decimal" placeholder="%"
                                                  value={d.tcsPercent}
                                                  onChange={e => updateCostDraft(q, { tcsPercent: e.target.value })}
                                                  className="border border-slate-300 px-1.5 py-1 w-16 font-mono tabular-nums text-right focus:outline-none focus:ring-1 focus:ring-amber-500" />
                                                <span className="text-slate-400 text-[10px]">%</span>
                                              </div>
                                              <div className="flex items-center gap-2">
                                                <span className="text-slate-600 w-20">Delivery</span>
                                                <select
                                                  value={d.deliveryBasis}
                                                  onChange={e => updateCostDraft(q, { deliveryBasis: e.target.value })}
                                                  className="border border-slate-300 px-1.5 py-1 text-[11px] focus:outline-none focus:ring-1 focus:ring-amber-500">
                                                  <option value="">—</option>
                                                  <option value="EX_WORKS">Ex Works</option>
                                                  <option value="FOR_DESTINATION">FOR Destination</option>
                                                  <option value="CIF">CIF</option>
                                                  <option value="FOB">FOB</option>
                                                  <option value="OTHER">Other</option>
                                                </select>
                                              </div>
                                            </div>
                                            <div className="mt-2 pt-2 border-t border-amber-200/70">
                                              <div className="text-[9px] font-bold text-slate-600 uppercase tracking-widest mb-1">
                                                Additional charges (JSON array — one entry per charge)
                                              </div>
                                              <textarea
                                                value={d.additionalChargesJson}
                                                onChange={e => updateCostDraft(q, { additionalChargesJson: e.target.value })}
                                                placeholder='e.g. [{"name":"Documentation","amount":150},{"name":"Handling","percent":0.5}]'
                                                rows={2}
                                                className="w-full border border-amber-200 bg-white px-2 py-1 text-[11px] font-mono text-slate-800 focus:outline-none focus:ring-1 focus:ring-amber-500" />
                                            </div>
                                          </div>
                                        );
                                      })()}
                                      {lineRatesLoading[q.id] && inputs.length === 0 ? (
                                        <div className="px-3 py-6 text-center text-[11px] text-slate-400">Loading items…</div>
                                      ) : (
                                        <table className="w-full text-[11px]">
                                          <thead className="bg-slate-100 border-b border-slate-200 text-slate-600">
                                            <tr>
                                              <th className="text-left px-3 py-1.5 w-8">#</th>
                                              <th className="text-left px-3 py-1.5">Item</th>
                                              <th className="text-right px-3 py-1.5 w-24">Qty × Unit</th>
                                              <th className="text-right px-3 py-1.5 w-32">Rate (₹/{inputs[0]?.unit || 'unit'}) *</th>
                                              <th className="text-right px-3 py-1.5 w-20">Disc %</th>
                                              <th className="text-right px-3 py-1.5 w-20">GST %</th>
                                              <th className="text-right px-3 py-1.5 w-32">Line Total (₹)</th>
                                              <th className="text-left px-3 py-1.5 w-56">Remarks (per item)</th>
                                              <th className="text-center px-3 py-1.5 w-16">Source</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {inputs.length === 0 && (
                                              <tr><td colSpan={9} className="px-3 py-4 text-center text-[11px] text-slate-400 italic">No items on this indent.</td></tr>
                                            )}
                                            {inputs.map(li => {
                                              const rate = parseFloat(li.unitRate) || 0;
                                              const disc = parseFloat(li.discountPercent) || 0;
                                              const lineTotal = rate * li.quantity * (1 - disc / 100);
                                              return (
                                                <tr key={li.lineId} className="border-b border-slate-100 last:border-b-0">
                                                  <td className="px-3 py-1.5 text-slate-500 font-mono">{li.lineNo}</td>
                                                  <td className="px-3 py-1.5">
                                                    <div className="font-bold text-slate-800">{li.itemName}</div>
                                                    {li.itemCode && <div className="text-[9px] text-slate-400 font-mono">{li.itemCode}</div>}
                                                  </td>
                                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700">
                                                    {li.quantity} {li.unit}
                                                  </td>
                                                  <td className="px-3 py-1.5 text-right">
                                                    <input type="number" step="any" inputMode="decimal" placeholder="0.00"
                                                      value={li.unitRate}
                                                      onChange={e => updateLineInput(q.id, li.lineId, 'unitRate', e.target.value)}
                                                      className="border border-slate-300 px-2 py-1 text-xs w-28 font-mono tabular-nums text-right focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                                  </td>
                                                  <td className="px-3 py-1.5 text-right">
                                                    <input type="number" step="any" inputMode="decimal" placeholder="0" min="0" max="100"
                                                      value={li.discountPercent}
                                                      onChange={e => updateLineInput(q.id, li.lineId, 'discountPercent', e.target.value)}
                                                      className="border border-slate-300 px-2 py-1 text-xs w-16 font-mono tabular-nums text-right focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                                  </td>
                                                  <td className="px-3 py-1.5 text-right">
                                                    <input type="number" step="any" inputMode="decimal" placeholder="—"
                                                      value={li.gstPercent}
                                                      onChange={e => updateLineInput(q.id, li.lineId, 'gstPercent', e.target.value)}
                                                      className="border border-slate-300 px-2 py-1 text-xs w-16 font-mono tabular-nums text-right focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                                  </td>
                                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800">
                                                    {lineTotal > 0 ? lineTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
                                                  </td>
                                                  <td className="px-3 py-1.5">
                                                    <input type="text" placeholder="(optional) e.g. brand, lead time"
                                                      value={li.remarks}
                                                      onChange={e => updateLineInput(q.id, li.lineId, 'remarks', e.target.value)}
                                                      className="border border-slate-300 px-2 py-1 text-xs w-full focus:outline-none focus:ring-1 focus:ring-blue-500" />
                                                  </td>
                                                  <td className="px-3 py-1.5 text-center">
                                                    {li.source === 'EMAIL_AUTO' ? (
                                                      <span className="inline-block text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 border border-purple-500 bg-purple-50 text-purple-700">AI</span>
                                                    ) : li.source === 'EMAIL_AUTO_LOW' ? (
                                                      <span title="AI flagged this read as LOW confidence — verify before award" className="inline-block text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 border border-amber-500 bg-amber-50 text-amber-800">AI · LOW</span>
                                                    ) : li.source === 'MANUAL' ? (
                                                      <span className="inline-block text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 border border-slate-400 bg-slate-50 text-slate-600">MANUAL</span>
                                                    ) : (
                                                      <span className="text-slate-300">—</span>
                                                    )}
                                                  </td>
                                                </tr>
                                              );
                                            })}
                                          </tbody>
                                          {inputs.length > 0 && (() => {
                                            const grandTotal = inputs.reduce((sum, li) => {
                                              const r = parseFloat(li.unitRate) || 0;
                                              const d = parseFloat(li.discountPercent) || 0;
                                              return sum + r * li.quantity * (1 - d / 100);
                                            }, 0);
                                            return (
                                              <tfoot className="bg-slate-50 border-t border-slate-300">
                                                <tr>
                                                  <td colSpan={6} className="px-3 py-1.5 text-right text-[10px] font-bold uppercase tracking-widest text-slate-600">Sub-total (post-discount, excl. GST)</td>
                                                  <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-slate-800">
                                                    {grandTotal > 0 ? grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—'}
                                                  </td>
                                                  <td colSpan={2}></td>
                                                </tr>
                                              </tfoot>
                                            );
                                          })()}
                                        </table>
                                      )}
                                      <div className="bg-slate-50 border-t border-slate-200 px-3 py-2 flex items-center justify-between">
                                        <div className="text-[10px] text-slate-500">
                                          * Rate is per unit, exclusive of GST. Leave blank for items the vendor has not quoted.
                                        </div>
                                        <button onClick={() => saveLineRates(pr.id, q.id)}
                                          disabled={lineRatesSaving[q.id] || inputs.length === 0}
                                          className="px-3 py-1 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-wide hover:bg-blue-700 disabled:bg-slate-400 flex items-center gap-1">
                                          <Check size={12} /> {lineRatesSaving[q.id] ? 'Saving…' : 'Save Rates'}
                                        </button>
                                      </div>
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
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
          )}
        </div>
      )}

      {/* ── RFQ Drawer — preview PDF, send email, track replies, AI-extract rate ── */}
      {rfqDrawer && (() => {
        const pr = reqs.find(r => r.id === rfqDrawer.prId);
        if (!pr) return null;
        const q = pr.quotes.find(qq => qq.id === rfqDrawer.quote.id) || rfqDrawer.quote;
        const pdfSrc = rfqPdfUrl; // blob URL with auth already resolved
        return (
          <div className="fixed inset-0 bg-black/40 flex items-stretch justify-end z-50" onClick={closeRfqDrawer}>
            <div className="bg-white shadow-2xl w-full max-w-4xl flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <FileText size={16} />
                  <h2 className="text-xs font-bold uppercase tracking-widest">RFQ — Indent #{pr.reqNo} → {q.vendor.name}</h2>
                </div>
                <button onClick={closeRfqDrawer} className="text-slate-400 hover:text-white text-xs">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {/* Status strip */}
                <div className="grid grid-cols-3 gap-2 text-[11px]">
                  <div className="bg-slate-50 border border-slate-200 px-3 py-2">
                    <div className="text-[9px] text-slate-500 uppercase tracking-widest">To</div>
                    <div className="font-bold text-slate-800 truncate" title={q.vendor.email || ''}>{q.vendor.email || <span className="text-red-500 italic">no email</span>}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 px-3 py-2">
                    <div className="text-[9px] text-slate-500 uppercase tracking-widest">Sent</div>
                    <div className="font-bold text-slate-800">{q.quoteRequestedAt ? fmtDate(q.quoteRequestedAt) : <span className="text-slate-400 italic">not sent</span>}</div>
                  </div>
                  <div className="bg-slate-50 border border-slate-200 px-3 py-2">
                    <div className="text-[9px] text-slate-500 uppercase tracking-widest">Quoted Rate</div>
                    <div className={`font-bold ${q.vendorRate ? 'text-green-700' : 'text-slate-400'}`}>
                      {q.vendorRate ? `Rs.${q.vendorRate.toLocaleString('en-IN')}` : <span className="italic">awaiting</span>}
                    </div>
                  </div>
                </div>

                {/* PDF Preview */}
                <div className="border border-slate-300">
                  <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between">
                    <div className="text-[10px] font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1">
                      <FileText size={12} /> RFQ Document Preview
                    </div>
                    {pdfSrc
                      ? <a href={pdfSrc} target="_blank" rel="noopener noreferrer" className="text-[10px] text-blue-600 hover:text-blue-800 underline">Open in new tab</a>
                      : <span className="text-[10px] text-slate-400">loading...</span>}
                  </div>
                  {pdfSrc
                    ? <iframe src={pdfSrc} className="w-full h-[480px]" title="RFQ PDF" />
                    : <div className="h-[480px] flex items-center justify-center text-xs text-slate-400">Generating PDF preview...</div>}
                </div>

                {/* Send form (only if not sent yet) */}
                {!q.quoteRequestedAt && (
                  <div className="border border-slate-300 p-3 space-y-2">
                    <div className="text-[10px] font-bold text-slate-700 uppercase tracking-widest">Send via Email</div>
                    <div className="grid grid-cols-1 gap-2">
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase tracking-widest">Additional Message (optional)</label>
                        <textarea value={rfqExtraMessage} onChange={e => setRfqExtraMessage(e.target.value)} rows={3}
                          placeholder="e.g. 'We need delivery by 30 April, please confirm earliest possible date.'"
                          className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none resize-none" />
                      </div>
                      <div>
                        <label className="text-[9px] text-slate-500 uppercase tracking-widest">CC (optional)</label>
                        <input value={rfqCc} onChange={e => setRfqCc(e.target.value)} placeholder="another@email.com"
                          className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" />
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-1">
                      <div className="text-[10px] text-slate-500">The PDF above is attached. The vendor is asked to reply on the same thread.</div>
                      <button onClick={handleSendRfq} disabled={rfqSending || !q.vendor.email}
                        className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-wide hover:bg-blue-700 disabled:bg-slate-400 flex items-center gap-1">
                        <Send size={12} /> {rfqSending ? 'Sending...' : 'Send Email'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Replies (after sent) */}
                {q.quoteRequestedAt && (
                  <div className="border border-slate-300">
                    <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between">
                      <div className="text-[10px] font-bold text-slate-700 uppercase tracking-widest flex items-center gap-1">
                        <Inbox size={12} /> Vendor Replies ({replies.length})
                      </div>
                      <div className="flex items-center gap-2">
                        <button onClick={() => {
                          const prId = rfqDrawer.prId;
                          const vrId = q.id;
                          setThreadDrawerQuery({ entityType: 'INDENT_QUOTE', entityId: vrId });
                          setThreadDrawerTitle(`Thread — ${q.vendor.name}`);
                          setThreadDrawerContext(`Indent #${pr.reqNo} · ${q.vendor.email || ''}`);
                          setThreadDrawerOnExtract(() => async (_tId: string, _rId: string) => {
                            if (!confirmOverwriteIfNeeded(q)) return;
                            await api.post(`/purchase-requisition/${prId}/vendors/${vrId}/extract-quote`, { autoApply: true }, { timeout: 120000 });
                            load();
                          });
                          setThreadDrawerEmptyAction({
                            label: 'Send RFQ Email Now',
                            remarksLabel: 'Special Remarks for this RFQ (added to PDF + email body, optional)',
                            previewUrl: `/purchase-requisition/${prId}/vendors/${vrId}/rfq-pdf`,
                            onClick: async (remarks?: string) => {
                              try {
                                await api.post(`/purchase-requisition/${prId}/vendors/${vrId}/send-rfq`, { extraMessage: remarks || undefined });
                                alert('RFQ sent. The thread will appear shortly.');
                                setThreadDrawerQuery({ entityType: 'INDENT_QUOTE', entityId: vrId });
                                load();
                              } catch (e: unknown) {
                                alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Send failed');
                              }
                            },
                          });
                          closeRfqDrawer();
                        }}
                          className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700 flex items-center gap-1">
                          <Mail size={10} /> Open Full Thread View
                        </button>
                        <button onClick={() => loadReplies(rfqDrawer.prId, q.id)} disabled={repliesLoading}
                          className="px-2 py-0.5 bg-white border border-slate-400 text-slate-700 text-[10px] font-medium hover:bg-slate-100 disabled:opacity-50 flex items-center gap-1">
                          <RefreshCw size={10} className={repliesLoading ? 'animate-spin' : ''} /> {repliesLoading ? 'Checking...' : 'Check Replies'}
                        </button>
                      </div>
                    </div>
                    <div className="p-3 space-y-2">
                      {!repliesLoading && replies.length === 0 && (
                        <div className="text-[11px] text-slate-400 italic text-center py-4">
                          No replies yet. Vendor hasn't responded — click "Check Replies" to refresh.
                        </div>
                      )}
                      {replies.map((r, i) => (
                        <div key={i} className="border border-slate-200">
                          <div className="bg-slate-50 border-b border-slate-200 px-3 py-1.5 flex items-center justify-between">
                            <div className="text-[11px]">
                              <span className="font-bold text-slate-800">{r.fromName || r.from}</span>
                              <span className="text-slate-500 ml-2">&lt;{r.from}&gt;</span>
                              <span className="text-slate-400 ml-2">· {fmtDate(r.date)}</span>
                            </div>
                            <button onClick={() => handleExtractQuote(rfqDrawer.prId, q.id, true)} disabled={extracting === q.id}
                              className="px-2 py-0.5 bg-purple-600 text-white text-[10px] font-medium hover:bg-purple-700 disabled:opacity-50 flex items-center gap-1">
                              <Sparkles size={10} /> {extracting === q.id ? 'AI Reading...' : 'AI Extract Rate'}
                            </button>
                          </div>
                          <div className="p-3 text-[11px] text-slate-700 whitespace-pre-wrap max-h-60 overflow-y-auto bg-white">{r.bodyText.slice(0, 2000) || '(no text body — AI will read attachments)'}</div>
                          {r.attachments.length > 0 && (
                            <div className="border-t border-slate-200 px-3 py-1.5 flex items-center gap-2 flex-wrap">
                              <Paperclip size={10} className="text-slate-500" />
                              {r.attachments.map((a, ai) => (
                                <button key={ai}
                                  onClick={() => openAttachment(rfqDrawer.prId, q.id, a.filename)}
                                  className="text-[10px] text-blue-600 hover:text-blue-800 underline flex items-center gap-0.5 bg-transparent border-0 cursor-pointer p-0"
                                  title={`${(a.size / 1024).toFixed(1)} KB · ${a.contentType}`}>
                                  {a.filename}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}

                      {/* Extracted quote preview */}
                      {extracted[q.id] && (
                        <div className="border border-purple-200 bg-purple-50/40 p-3 space-y-1">
                          <div className="text-[10px] font-bold text-purple-800 uppercase tracking-widest flex items-center gap-1">
                            <Sparkles size={10} /> AI-Extracted Quote (confidence: {extracted[q.id].confidence})
                            {extracted[q.id].overallDiscountPercent ? (
                              <span className="ml-2 inline-block text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 border border-emerald-500 bg-emerald-50 text-emerald-700">
                                Footer discount: {extracted[q.id].overallDiscountPercent}% (applied to all lines)
                              </span>
                            ) : null}
                          </div>
                          {extracted[q.id].overallRateNote && <div className="text-[11px] text-slate-700">{extracted[q.id].overallRateNote}</div>}
                          {extracted[q.id].lineRates.length > 0 && (
                            <table className="w-full text-[10px]">
                              <thead><tr className="text-slate-500 border-b border-slate-200">
                                <th className="text-left py-1">Line</th><th className="text-left py-1">Item (as quoted)</th>
                                <th className="text-right py-1">Rate</th><th className="text-right py-1">Disc%</th><th className="text-right py-1">GST%</th>
                                <th className="text-left py-1">Remarks</th>
                              </tr></thead>
                              <tbody>
                                {extracted[q.id].lineRates.map((l, li) => {
                                  const effectiveDisc = (l.discountPercent && l.discountPercent > 0)
                                    ? l.discountPercent
                                    : (extracted[q.id].overallDiscountPercent || 0);
                                  return (
                                    <tr key={li} className="border-b border-slate-100">
                                      <td className="py-1 font-mono">{l.lineNo ?? '—'}</td>
                                      <td className="py-1">{l.itemName || '—'}</td>
                                      <td className="py-1 text-right font-mono tabular-nums font-bold">{l.unitRate != null ? `Rs.${l.unitRate.toLocaleString('en-IN')}` : '—'}</td>
                                      <td className="py-1 text-right font-mono tabular-nums text-emerald-700">{effectiveDisc > 0 ? `${effectiveDisc}%` : '—'}</td>
                                      <td className="py-1 text-right font-mono tabular-nums">{l.gstPercent ?? '—'}</td>
                                      <td className="py-1 text-slate-500">{l.remarks || '—'}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          )}
                          <div className="grid grid-cols-3 gap-2 text-[10px] pt-1">
                            {extracted[q.id].deliveryDays && <div><span className="text-slate-500">Delivery:</span> <b>{extracted[q.id].deliveryDays} days</b></div>}
                            {extracted[q.id].paymentTerms && <div><span className="text-slate-500">Payment:</span> <b>{extracted[q.id].paymentTerms}</b></div>}
                            {extracted[q.id].freightTerms && <div><span className="text-slate-500">Freight:</span> <b>{extracted[q.id].freightTerms}</b></div>}
                            {extracted[q.id].quoteValidityDays && <div><span className="text-slate-500">Valid:</span> <b>{extracted[q.id].quoteValidityDays} days</b></div>}
                            {extracted[q.id].extractedTotal && <div><span className="text-slate-500">Total:</span> <b>Rs.{extracted[q.id].extractedTotal!.toLocaleString('en-IN')}</b></div>}
                            {extracted[q.id].deliveryBasis && <div><span className="text-slate-500">Basis:</span> <b>{extracted[q.id].deliveryBasis}</b></div>}
                          </div>
                          {/* Structured cost components extracted from the quote */}
                          {(() => {
                            const e = extracted[q.id];
                            const charges: Array<{ label: string; pct?: number; amt?: number }> = [
                              { label: 'Packing', pct: e.packingPercent, amt: e.packingAmount },
                              { label: 'Freight', pct: e.freightPercent, amt: e.freightAmount },
                              { label: 'Insurance', pct: e.insurancePercent, amt: e.insuranceAmount },
                              { label: 'Loading', pct: e.loadingPercent, amt: e.loadingAmount },
                            ].filter(c => (c.pct && c.pct > 0) || (c.amt && c.amt > 0));
                            const extra = e.additionalCharges || [];
                            const hasAny = charges.length > 0 || extra.length > 0 || e.isRateInclusiveOfGst || (e.tcsPercent && e.tcsPercent > 0);
                            if (!hasAny) return null;
                            return (
                              <div className="mt-1 pt-1 border-t border-purple-200/70 flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
                                <span className="text-purple-700 font-bold uppercase tracking-wider text-[9px]">Cost components extracted:</span>
                                {charges.map(c => (
                                  <span key={c.label}>
                                    <span className="text-slate-500">{c.label}:</span>{' '}
                                    <b>{c.pct ? `${c.pct}%` : `Rs.${c.amt?.toLocaleString('en-IN')}`}</b>
                                  </span>
                                ))}
                                {extra.map((c, i) => (
                                  <span key={i}>
                                    <span className="text-slate-500">{c.name}:</span>{' '}
                                    <b>{c.percent ? `${c.percent}%` : `Rs.${c.amount?.toLocaleString('en-IN')}`}</b>
                                  </span>
                                ))}
                                {e.tcsPercent && e.tcsPercent > 0 && <span><span className="text-slate-500">TCS:</span> <b>{e.tcsPercent}%</b></span>}
                                {e.isRateInclusiveOfGst && <span className="text-amber-700 font-bold">⚠ Rate is GST-inclusive</span>}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Vendor Picker Modal ── */}
      {vendorPickFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setVendorPickFor(null); setVendorQuery(''); }}>
          <div className="bg-white shadow-2xl w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest">Add Vendor to Indent</h2>
              <button onClick={() => { setVendorPickFor(null); setVendorQuery(''); }} className="text-slate-400 hover:text-white text-xs">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <input type="text" value={vendorQuery} onChange={e => setVendorQuery(e.target.value)} placeholder="Search vendor name / email / phone..." autoFocus
                className="w-full border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
              <div className="max-h-80 overflow-y-auto border border-slate-200">
                {(() => {
                  const q = vendorQuery.toLowerCase().trim();
                  const already = new Set((reqs.find(r => r.id === vendorPickFor)?.quotes || []).map(q => q.vendorId));
                  const matches = (q.length === 0 ? vendors : vendors.filter(v =>
                    v.name.toLowerCase().includes(q) || (v.email || '').toLowerCase().includes(q) || (v.phone || '').includes(q)
                  )).slice(0, 60);
                  if (matches.length === 0) return <div className="px-3 py-6 text-center text-xs text-slate-400">No vendors match</div>;
                  return matches.map(v => {
                    const isAdded = already.has(v.id);
                    return (
                      <div key={v.id} className={`px-3 py-2 text-xs border-b border-slate-100 flex items-center justify-between ${isAdded ? 'opacity-40' : 'hover:bg-blue-50 cursor-pointer'}`}
                        onClick={() => !isAdded && handleAddVendor(vendorPickFor, v)}>
                        <div>
                          <div className="font-bold text-slate-800">{v.name}</div>
                          <div className="text-[10px] text-slate-500">{v.email || <span className="italic text-red-500">no email</span>}{v.phone ? ` · ${v.phone}` : ''}</div>
                        </div>
                        {isAdded
                          ? <span className="text-[10px] text-slate-400 italic">already added</span>
                          : <button className="px-2 py-1 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">Add</button>}
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reject Modal ── */}
      {rejectingId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setRejectingId(null)}>
          <div className="bg-white shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <h2 className="text-xs font-bold uppercase tracking-widest">Reject Indent</h2>
            </div>
            <div className="p-4 space-y-3">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Reason for Rejection</label>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)} rows={3}
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none"
                placeholder="Why is this rejected?" />
              <div className="flex justify-end gap-2">
                <button onClick={() => { setRejectingId(null); setRejectReason(''); }} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                <button onClick={handleReject} disabled={!rejectReason.trim()} className="px-3 py-1 bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 disabled:opacity-50">Confirm Reject</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Reusable Gmail-style thread drawer ── */}
      {threadDrawerQuery && (
        <EmailThreadDrawer
          query={threadDrawerQuery}
          title={threadDrawerTitle}
          contextLabel={threadDrawerContext}
          onClose={() => { setThreadDrawerQuery(null); setThreadDrawerEmptyAction(null); setThreadDrawerOnExtract(null); }}
          onExtractAI={threadDrawerOnExtract || undefined}
          emptyStateAction={threadDrawerEmptyAction || undefined}
        />
      )}
    </div>
  );
}
