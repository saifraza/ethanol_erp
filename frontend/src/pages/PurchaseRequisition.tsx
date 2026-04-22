import React, { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { Plus, Check, X, Trash2, Mail, Award, RefreshCw } from 'lucide-react';

// ── Enums ──
const URGENCIES = ['ROUTINE', 'SOON', 'URGENT', 'EMERGENCY'];
const GOODS_CATEGORIES = ['SPARE_PART', 'RAW_MATERIAL', 'CONSUMABLE', 'TOOL', 'SAFETY', 'CHEMICAL', 'MECHANICAL', 'ELECTRICAL', 'GENERAL'];
const SERVICE_CATEGORIES = ['CONSULTANCY', 'PROFESSIONAL_SERVICE', 'IT_SERVICE', 'AMC_SERVICE', 'CONTRACT_LABOR', 'CIVIL_WORK', 'TRANSPORT_SERVICE', 'OTHER_SERVICE'];
const GOODS_UNITS = ['nos', 'kg', 'ltr', 'mtr', 'set', 'pair', 'roll'];
const SERVICE_UNITS = ['lump-sum', 'man-day', 'man-hour', 'month', 'visit', 'job'];
const STATUS_TABS = ['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'PO_PENDING', 'ORDERED', 'RECEIVED', 'COMPLETED', 'REJECTED'];

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
  RECEIVED: 'border-emerald-600 bg-emerald-50 text-emerald-700',
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
  isAwarded: boolean;
  createdAt: string;
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
    { label: 'Received', state: ['RECEIVED', 'COMPLETED'].includes(status) ? 'done' : status === 'ORDERED' ? 'current' : 'pending' },
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
  const [actionLoading, setActionLoading] = useState(false);
  const [itemHistory, setItemHistory] = useState<ItemHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  // ── Vendor-pick modal ──
  const [vendorPickFor, setVendorPickFor] = useState<string | null>(null);
  const [vendorQuery, setVendorQuery] = useState('');

  // ── Per-row inputs for quote rate / remarks ──
  const [quoteInput, setQuoteInput] = useState<Record<string, { rate: string; remarks: string }>>({});

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

  const handleRequestQuote = async (prId: string, quote: Quote) => {
    const pr = reqs.find(r => r.id === prId);
    if (!pr) return;
    const subject = `Quote Request - Indent #${pr.reqNo} - ${pr.itemName}`;
    try {
      await api.post(`/purchase-requisition/${prId}/vendors/${quote.id}/request-quote`, { emailSubject: subject });
      load();
      if (quote.vendor.email) {
        const body = `Dear ${quote.vendor.name},%0D%0A%0D%0AKindly send us your best rate for the below item. Please REPLY ON THIS SAME EMAIL so our system can match your quote automatically.%0D%0A%0D%0AItem: ${pr.itemName}%0D%0AQuantity: ${pr.quantity} ${pr.unit}%0D%0A%0D%0ARegards,%0D%0AMSPIL Purchase Team%0D%0A%0D%0A[Ref: IND-${pr.reqNo}-${quote.id.slice(0, 6)}]`;
        window.open(`mailto:${quote.vendor.email}?subject=${encodeURIComponent(subject)}&body=${body}`, '_blank');
      } else {
        alert('Marked as requested. Vendor has no email — please contact by phone.');
      }
    } catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
  };

  const handleSaveRate = async (prId: string, quoteId: string) => {
    const input = quoteInput[quoteId];
    if (!input || !input.rate || parseFloat(input.rate) <= 0) { alert('Enter a valid rate'); return; }
    try {
      await api.put(`/purchase-requisition/${prId}/vendors/${quoteId}`, {
        vendorRate: parseFloat(input.rate),
        quoteRemarks: input.remarks || '',
        quoteSource: 'MANUAL',
      });
      setQuoteInput(prev => { const n = { ...prev }; delete n[quoteId]; return n; });
      load();
    } catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
  };

  const handleAward = async (prId: string, quoteId: string) => {
    if (!confirm('Award this vendor? They will become the supplier for the PO.')) return;
    try { await api.post(`/purchase-requisition/${prId}/vendors/${quoteId}/award`); load(); }
    catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
  };

  const handleDeleteQuote = async (prId: string, quoteId: string) => {
    if (!confirm('Remove this vendor row?')) return;
    try { await api.delete(`/purchase-requisition/${prId}/vendors/${quoteId}`); load(); }
    catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
  };

  // ── Filter list ──
  const filtered = reqs.filter(pr => {
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
        <div className="flex gap-0">
          <button onClick={() => setTab('list')}
            className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 transition ${tab === 'list' ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            All Indents ({reqs.length})
          </button>
          <button onClick={() => setTab('new')}
            className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 transition ${tab === 'new' ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            + New Indent
          </button>
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
                      <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100 text-[10px] truncate max-w-[140px]" title={shownVendor}>
                        {awardedQuote && <Award size={10} className="inline text-green-600 mr-0.5" />}
                        {shownVendor}
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

                      {/* ── MIDDLE: Store Actions ── */}
                      <div className="bg-white border border-slate-200 p-3 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Store Actions</div>
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
                              <div className="flex items-center justify-between">
                                <div className="text-[11px] text-slate-500">Service / one-off — no stock to check</div>
                                <button onClick={() => handleFullPurchase(pr.id)} disabled={actionLoading} className="px-2 py-1 bg-purple-600 text-white text-[10px] font-medium hover:bg-purple-700 disabled:opacity-50">
                                  Approve & Purchase
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
                        {pr.status === 'ORDERED' && (
                          <button onClick={() => updateStatus(pr.id, 'RECEIVED')} className="px-2 py-1 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">Mark Received</button>
                        )}
                        {pr.status === 'REJECTED' && (
                          <button onClick={() => updateStatus(pr.id, 'DRAFT')} className="px-2 py-1 border border-slate-400 bg-white text-slate-700 text-[10px] font-medium hover:bg-slate-100">Resubmit as Draft</button>
                        )}
                        {['RECEIVED', 'COMPLETED'].includes(pr.status) && (
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
                            <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Requested</th>
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
                            const editing = quoteInput[q.id];
                            const total = q.vendorRate ? q.vendorRate * pr.quantity : 0;
                            return (
                              <tr key={q.id} className={`border-b border-slate-100 ${q.isAwarded ? 'bg-green-50' : ''}`}>
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
                                <td className="px-3 py-1.5 text-slate-500 text-[10px]">
                                  {q.quoteRequestedAt ? (
                                    <>
                                      <div>{fmtDate(q.quoteRequestedAt)}</div>
                                      {q.quoteRequestedBy && <div className="text-[9px]">by {q.quoteRequestedBy}</div>}
                                    </>
                                  ) : <span className="italic">not requested</span>}
                                </td>
                                <td className="px-3 py-1.5 text-right">
                                  {q.vendorRate != null && !editing ? (
                                    <div className="font-bold text-green-700 font-mono tabular-nums">{q.vendorRate.toLocaleString('en-IN')}</div>
                                  ) : (
                                    <input type="number" step="any" placeholder="Rate"
                                      value={editing?.rate ?? ''}
                                      onChange={e => setQuoteInput(prev => ({ ...prev, [q.id]: { rate: e.target.value, remarks: prev[q.id]?.remarks || '' } }))}
                                      className="border border-slate-300 px-2 py-0.5 text-xs w-24 font-mono tabular-nums text-right" />
                                  )}
                                  {q.quotedAt && <div className="text-[9px] text-slate-400">{fmtDate(q.quotedAt)}</div>}
                                </td>
                                <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800">
                                  {total > 0 ? total.toLocaleString('en-IN') : '—'}
                                </td>
                                <td className="px-3 py-1.5 text-[10px] text-slate-500">
                                  {q.quoteSource || <span className="italic">—</span>}
                                  {q.quoteRemarks && <div className="text-[9px] italic truncate max-w-[120px]" title={q.quoteRemarks}>{q.quoteRemarks}</div>}
                                </td>
                                <td className="px-3 py-1.5 text-center">
                                  <div className="flex items-center justify-center gap-1">
                                    {!q.quoteRequestedAt && q.vendor.email && (
                                      <button onClick={() => handleRequestQuote(pr.id, q)} title="Email quote request" className="text-blue-600 hover:text-blue-800 p-0.5">
                                        <Mail size={14} />
                                      </button>
                                    )}
                                    {q.vendorRate == null && (
                                      <button onClick={() => setQuoteInput(prev => ({ ...prev, [q.id]: prev[q.id] ?? { rate: '', remarks: '' } }))}
                                        title="Enter rate manually" className="px-1.5 py-0.5 bg-white border border-blue-500 text-blue-600 text-[10px] font-medium hover:bg-blue-50">
                                        Enter Rate
                                      </button>
                                    )}
                                    {editing && (
                                      <button onClick={() => handleSaveRate(pr.id, q.id)} className="px-1.5 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">Save</button>
                                    )}
                                    {q.vendorRate != null && !editing && !q.isAwarded && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(pr.status) && (
                                      <button onClick={() => handleAward(pr.id, q.id)} title="Award this vendor"
                                        className="px-1.5 py-0.5 bg-green-600 text-white text-[10px] font-medium hover:bg-green-700 flex items-center gap-0.5">
                                        <Award size={10} /> Award
                                      </button>
                                    )}
                                    {q.vendorRate != null && !editing && (
                                      <button onClick={() => setQuoteInput(prev => ({ ...prev, [q.id]: { rate: String(q.vendorRate), remarks: q.quoteRemarks || '' } }))} title="Update rate"
                                        className="text-slate-500 hover:text-slate-700 p-0.5">
                                        <RefreshCw size={12} />
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
    </div>
  );
}
