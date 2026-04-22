import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { Plus, Check, X, ChevronDown, ChevronUp, Search, Copy, Trash2 } from 'lucide-react';

const URGENCIES = ['ROUTINE', 'SOON', 'URGENT', 'EMERGENCY'];
const GOODS_CATEGORIES = ['SPARE_PART', 'RAW_MATERIAL', 'CONSUMABLE', 'TOOL', 'SAFETY', 'CHEMICAL', 'MECHANICAL', 'ELECTRICAL', 'GENERAL'];
const SERVICE_CATEGORIES = ['CONSULTANCY', 'PROFESSIONAL_SERVICE', 'IT_SERVICE', 'AMC_SERVICE', 'CONTRACT_LABOR', 'CIVIL_WORK', 'TRANSPORT_SERVICE', 'OTHER_SERVICE'];
const CATEGORIES = [...GOODS_CATEGORIES, ...SERVICE_CATEGORIES];
const GOODS_UNITS = ['nos', 'kg', 'ltr', 'mtr', 'set', 'pair', 'roll'];
const SERVICE_UNITS = ['lump-sum', 'man-day', 'man-hour', 'month', 'visit', 'job'];
const ALL_UNITS = [...GOODS_UNITS, ...SERVICE_UNITS];
const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'PO_PENDING', 'ORDERED', 'RECEIVED', 'COMPLETED', 'REJECTED'];

interface InvItem { id: string; name: string; code: string; category: string; unit: string; currentStock: number; minStock: number; costPerUnit: number; supplier: string | null; }
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

interface Vendor {
  id: string; name: string; email: string | null; phone: string | null;
  contactPerson?: string | null;
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
  // Quote / vendor tracking
  vendorId: string | null;
  vendor: Pick<Vendor, 'id' | 'name' | 'email' | 'phone'> | null;
  quoteRequestedAt: string | null;
  quoteRequestedBy: string | null;
  quoteEmailSubject: string | null;
  quoteEmailThreadId: string | null;
  vendorRate: number | null;
  vendorQuotedAt: string | null;
  quoteSource: string | null;
  quoteRemarks: string | null;
}

interface ItemHistory {
  recent: Array<{
    poNo: number; poDate: string; rate: number; quantity: number; unit: string;
    status: string; vendorName?: string; vendorEmail?: string;
  }>;
  stats: { minRate: number; maxRate: number; avgRate: number; lastRate: number; totalPos: number } | null;
}

export default function PurchaseRequisition() {
  const [searchParams] = useSearchParams();
  const [reqs, setReqs] = useState<PR[]>([]);
  const [stats, setStats] = useState<{ byStatus?: Record<string, number>; total?: number; totalValue?: number; pendingValue?: number }>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'list' | 'new' | 'bulk'>(searchParams.get('new') ? 'new' : 'list');
  const [filterStatus, setFilterStatus] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '', itemName: '', quantity: '1', unit: 'nos', estimatedCost: '',
    urgency: 'ROUTINE', category: 'GENERAL', justification: '', supplier: '', supplierPhone: '', remarks: '',
    department: '', inventoryItemId: '', requestedByPerson: '',
  });
  const [saving, setSaving] = useState(false);

  // --- Bulk entry (Excel-style) ---
  type BulkRow = {
    itemQuery: string;
    itemName: string;
    inventoryItemId: string;
    quantity: string;
    unit: string;
    estimatedCost: string;
    urgency: string;
    category: string;
    supplier: string;
    justification: string;
  };
  const blankRow = (): BulkRow => ({
    itemQuery: '', itemName: '', inventoryItemId: '', quantity: '1', unit: 'nos',
    estimatedCost: '', urgency: 'ROUTINE', category: 'GENERAL', supplier: '', justification: '',
  });
  const [bulkCommon, setBulkCommon] = useState({ department: '', requestedByPerson: '' });
  const [bulkRows, setBulkRows] = useState<BulkRow[]>([blankRow(), blankRow(), blankRow()]);
  const [bulkFocused, setBulkFocused] = useState<number | null>(null);
  const [bulkSaving, setBulkSaving] = useState(false);

  const updateBulkRow = (i: number, patch: Partial<BulkRow>) => {
    setBulkRows(rows => rows.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  };
  const pickItemForBulk = (i: number, it: InvItem) => {
    updateBulkRow(i, {
      itemQuery: it.name,
      itemName: it.name,
      inventoryItemId: it.id,
      unit: it.unit,
      estimatedCost: it.costPerUnit && it.costPerUnit > 0 ? String(it.costPerUnit) : '',
      category: it.category || 'GENERAL',
      supplier: it.supplier || '',
    });
    setBulkFocused(null);
  };
  const addBulkRow = () => setBulkRows(rows => [...rows, blankRow()]);
  const copyBulkRow = (i: number) => setBulkRows(rows => [...rows.slice(0, i + 1), { ...rows[i] }, ...rows.slice(i + 1)]);
  const deleteBulkRow = (i: number) => setBulkRows(rows => rows.length === 1 ? [blankRow()] : rows.filter((_, idx) => idx !== i));
  const submitBulk = async () => {
    if (!bulkCommon.department) { alert('Department is required'); return; }
    const valid = bulkRows.filter(r => r.itemName.trim() && parseFloat(r.quantity) > 0);
    if (valid.length === 0) { alert('Add at least one row with item name and quantity'); return; }
    setBulkSaving(true);
    try {
      await api.post('/purchase-requisition/bulk', {
        status: 'SUBMITTED',
        common: bulkCommon,
        rows: valid,
      });
      setBulkRows([blankRow(), blankRow(), blankRow()]);
      setBulkCommon({ department: '', requestedByPerson: '' });
      setTab('list');
      load();
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Bulk submit failed');
    }
    setBulkSaving(false);
  };

  // Warehouse issue state
  const [stockCheck, setStockCheck] = useState<{ id: string; available: number; requested: number; canFulfillFromStock: number; shortfall: number; unit: string } | null>(null);
  const [issueQty, setIssueQty] = useState('');
  const [issuing, setIssuing] = useState(false);

  const checkStock = async (prId: string, requested: number) => {
    try {
      const res = await api.get(`/purchase-requisition/${prId}/stock-check`);
      setStockCheck({ id: prId, ...res.data });
      setIssueQty(String(Math.min(res.data.available, requested)));
    } catch { setStockCheck({ id: prId, available: 0, requested, canFulfillFromStock: 0, shortfall: requested, unit: 'nos' }); }
  };

  const handleIssue = async (prId: string) => {
    setIssuing(true);
    try {
      const res = await api.put(`/purchase-requisition/${prId}/issue`, { issuedQty: parseFloat(issueQty) || 0 });
      const autoPO = (res.data as { autoPO?: { created: boolean; poNo?: number; reason?: string } }).autoPO;
      setStockCheck(null);
      setIssueQty('');
      load();
      if (autoPO) {
        alert(autoPO.created
          ? `Draft PO #${autoPO.poNo} created for the shortfall`
          : `Purchase shortfall logged — ${autoPO.reason || 'manual PO required'}`);
      }
    } catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Issue failed'); }
    setIssuing(false);
  };

  // Store-side action handlers (merged from StoreIndents page)
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const handleFullPurchase = async (prId: string) => {
    setIssuing(true);
    try {
      const res = await api.put(`/purchase-requisition/${prId}/issue`, { issuedQty: 0 });
      const autoPO = (res.data as { autoPO?: { created: boolean; poNo?: number; reason?: string } }).autoPO;
      setStockCheck(null);
      setIssueQty('');
      load();
      if (autoPO) {
        alert(autoPO.created
          ? `Draft PO #${autoPO.poNo} created — review and send to vendor`
          : `Sent to purchase queue — ${autoPO.reason || 'manual PO required'}`);
      }
    } catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
    setIssuing(false);
  };
  const handleReject = async () => {
    if (!rejectingId || !rejectReason.trim()) return;
    try {
      await api.put(`/purchase-requisition/${rejectingId}`, { status: 'REJECTED', rejectionReason: rejectReason });
      setRejectingId(null);
      setRejectReason('');
      load();
    } catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
  };
  const handleMarkOrdered = async (prId: string) => {
    try { await api.put(`/purchase-requisition/${prId}`, { status: 'ORDERED' }); load(); }
    catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
  };
  const handleMarkReceived = async (prId: string) => {
    try { await api.put(`/purchase-requisition/${prId}`, { status: 'RECEIVED' }); load(); }
    catch (e: unknown) { alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed'); }
  };

  // Inventory item search for linking
  const [invItems, setInvItems] = useState<InvItem[]>([]);
  const [itemQuery, setItemQuery] = useState('');
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [itemHistory, setItemHistory] = useState<ItemHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [quoteRateInput, setQuoteRateInput] = useState<Record<string, string>>({});
  const [quoteRemarksInput, setQuoteRemarksInput] = useState<Record<string, string>>({});
  const [selectVendorFor, setSelectVendorFor] = useState<string | null>(null);
  const [vendorQuery, setVendorQuery] = useState('');

  const fetchItemHistory = async (itemId: string) => {
    setHistoryLoading(true);
    try {
      const res = await api.get<ItemHistory>(`/purchase-requisition/item-history/${itemId}`);
      setItemHistory(res.data);
    } catch {
      setItemHistory(null);
    }
    setHistoryLoading(false);
  };

  const handleRequestQuote = async (prId: string, vendor: Vendor) => {
    const subject = `Quote Request - Indent #${reqs.find(r => r.id === prId)?.reqNo || ''} - ${reqs.find(r => r.id === prId)?.itemName || ''}`;
    try {
      await api.post(`/purchase-requisition/${prId}/request-quote`, {
        vendorId: vendor.id,
        emailSubject: subject,
      });
      setSelectVendorFor(null);
      setVendorQuery('');
      load();
      if (vendor.email) {
        const body = `Dear ${vendor.name},%0D%0A%0D%0AKindly send us your best rate for the below item. Please reply on this same email so we can track it.%0D%0A%0D%0AItem: ${reqs.find(r => r.id === prId)?.itemName}%0D%0AQuantity: ${reqs.find(r => r.id === prId)?.quantity} ${reqs.find(r => r.id === prId)?.unit}%0D%0A%0D%0ARegards,%0D%0AMSPIL Purchase Team`;
        window.open(`mailto:${vendor.email}?subject=${encodeURIComponent(subject)}&body=${body}`, '_blank');
      } else {
        alert(`Marked as quote-requested. Vendor has no email on file — contact by phone (${vendor.phone || 'n/a'}).`);
      }
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to record quote request');
    }
  };

  const handleSaveQuoteRate = async (prId: string) => {
    const rate = quoteRateInput[prId];
    if (!rate || parseFloat(rate) <= 0) { alert('Enter a valid rate'); return; }
    try {
      await api.put(`/purchase-requisition/${prId}/update-quote-rate`, {
        vendorRate: parseFloat(rate),
        quoteRemarks: quoteRemarksInput[prId] || '',
        quoteSource: 'MANUAL',
      });
      setQuoteRateInput(prev => { const next = { ...prev }; delete next[prId]; return next; });
      setQuoteRemarksInput(prev => { const next = { ...prev }; delete next[prId]; return next; });
      load();
    } catch (e: unknown) {
      alert((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Failed to save rate');
    }
  };

  useEffect(() => {
    api.get('/inventory/items').then(r => setInvItems(r.data.items || [])).catch(() => {});
    api.get('/departments').then(r => setDepartments((r.data || []).filter((d: { isActive: boolean }) => d.isActive).map((d: { name: string }) => d.name))).catch(() => {});
    api.get('/vendors?limit=500').then(r => {
      const v = (r.data.vendors || r.data || []).map((v: { id: string; name: string; phone?: string; email?: string; contactPerson?: string }) => ({
        id: v.id, name: v.name, email: v.email || null, phone: v.phone || null, contactPerson: v.contactPerson || null,
      }));
      setVendors(v);
    }).catch(() => {});
    // Pre-fill from URL params (linked from Inventory page)
    const itemId = searchParams.get('itemId');
    const itemName = searchParams.get('itemName');
    if (itemName) {
      setForm(f => ({ ...f, itemName: itemName, inventoryItemId: itemId || '' }));
      setItemQuery(itemName);
    }
  }, [searchParams]);

  const load = async () => {
    try {
      const [reqsRes, statsRes] = await Promise.all([
        api.get('/purchase-requisition' + (filterStatus ? `?status=${filterStatus}` : '')),
        api.get('/purchase-requisition/stats'),
      ]);
      setReqs(reqsRes.data.requisitions);
      setStats(statsRes.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [filterStatus]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const submitForm = { ...form, title: form.title || `Need ${form.itemName}`, status: 'SUBMITTED' };
      await api.post('/purchase-requisition', submitForm);
      setForm({ title: '', itemName: '', quantity: '1', unit: 'nos', estimatedCost: '', urgency: 'ROUTINE', category: 'GENERAL', justification: '', supplier: '', supplierPhone: '', remarks: '', department: '', inventoryItemId: '', requestedByPerson: '' });
      setItemQuery('');
      setTab('list');
      load();
    } catch (e: any) { alert(e.response?.data?.error || 'Error'); }
    setSaving(false);
  };

  const updateStatus = async (id: string, status: string, extra?: any) => {
    try {
      await api.put(`/purchase-requisition/${id}`, { status, ...extra });
      load();
    } catch (e: any) { alert(e.response?.data?.error || 'Error'); }
  };

  if (loading) return <div className="p-6 text-center text-xs text-slate-400">Loading requisitions...</div>;

  return (
    <div className="space-y-0">
      {/* Page Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">Indents</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Plant raises → Store reviews → Issue or send to Purchase</span>
        </div>
        <button
          onClick={() => setTab('new')}
          className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1"
        >
          <Plus size={14} /> New Request
        </button>
      </div>

      {/* Status Filter KPI Strip */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        {STATUSES.map(s => (
          <div
            key={s}
            className={`bg-white px-3 py-2.5 text-center cursor-pointer border-r border-slate-200 hover:bg-blue-50/60 transition ${
              filterStatus === s ? 'ring-2 ring-inset ring-blue-500 bg-blue-50' : ''
            }`}
            onClick={() => setFilterStatus(filterStatus === s ? '' : s)}
          >
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">{s}</div>
            <div className="text-lg font-bold text-slate-800">{stats.byStatus?.[s] || 0}</div>
          </div>
        ))}
      </div>

      {/* Summary KPI Strip */}
      <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-white px-4 py-3 border-l-4 border-l-blue-600 border-r border-slate-200">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Requests</div>
          <div className="text-xl font-bold text-slate-800">{stats.total || 0}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-orange-500 border-r border-slate-200">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Pending Value</div>
          <div className="text-xl font-bold text-orange-600 font-mono tabular-nums">Rs.{((stats.pendingValue || 0) / 1000).toFixed(1)}K</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-emerald-600">
          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Total Value</div>
          <div className="text-xl font-bold text-slate-800 font-mono tabular-nums">Rs.{((stats.totalValue || 0) / 1000).toFixed(1)}K</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-0 -mx-3 md:-mx-6 flex gap-0">
        <button
          onClick={() => setTab('list')}
          className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 transition ${
            tab === 'list'
              ? 'border-blue-600 text-blue-700 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          All Requests ({reqs.length})
        </button>
        <button
          onClick={() => setTab('new')}
          className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 transition ${
            tab === 'new'
              ? 'border-blue-600 text-blue-700 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          + New Request
        </button>
        <button
          onClick={() => setTab('bulk')}
          className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 transition ${
            tab === 'bulk'
              ? 'border-blue-600 text-blue-700 bg-white'
              : 'border-transparent text-slate-500 hover:text-slate-700'
          }`}
        >
          Bulk Entry (Excel)
        </button>
      </div>

      {/* New Request Form */}
      {tab === 'new' && (
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-slate-100 border-b border-slate-300 px-4 py-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-700">New Purchase Request</h3>
          </div>
          <form onSubmit={handleCreate} className="p-4 space-y-3">
            {/* Row 1: Item search + Qty */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="relative md:col-span-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Item (search inventory) *</label>
                <div className="relative">
                  <input
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    placeholder="Type to search items or enter new item name..."
                    required
                    value={itemQuery}
                    onChange={e => { setItemQuery(e.target.value); setForm(f => ({ ...f, itemName: e.target.value, title: `Need ${e.target.value}` })); setShowItemDropdown(true); }}
                    onFocus={() => setShowItemDropdown(true)}
                    onBlur={() => setTimeout(() => setShowItemDropdown(false), 200)}
                  />
                  {showItemDropdown && itemQuery.length >= 2 && (
                    <div className="absolute z-10 w-full bg-white border border-slate-300 shadow-lg max-h-40 overflow-y-auto mt-0.5">
                      {invItems.filter(it => it.name.toLowerCase().includes(itemQuery.toLowerCase()) || it.code.toLowerCase().includes(itemQuery.toLowerCase())).slice(0, 8).map(it => (
                        <div key={it.id} className="px-2.5 py-1.5 text-xs hover:bg-blue-50 cursor-pointer border-b border-slate-100 flex justify-between"
                          onMouseDown={() => {
                            setItemQuery(it.name);
                            setForm(f => ({
                              ...f,
                              itemName: it.name,
                              inventoryItemId: it.id,
                              unit: it.unit,
                              estimatedCost: it.costPerUnit && it.costPerUnit > 0 ? String(it.costPerUnit) : f.estimatedCost,
                              category: it.category || f.category,
                              supplier: it.supplier || f.supplier,
                              title: `Need ${it.name}`,
                            }));
                            setShowItemDropdown(false);
                          }}>
                          <span className="text-slate-800 font-medium">{it.name}</span>
                          <span className="text-slate-400 text-[10px]">{it.code} | Stock: {it.currentStock} {it.unit}</span>
                        </div>
                      ))}
                      {invItems.filter(it => it.name.toLowerCase().includes(itemQuery.toLowerCase())).length === 0 && (
                        <div className="px-2.5 py-1.5 text-[10px] text-slate-400">No matching item — will be created as new request</div>
                      )}
                    </div>
                  )}
                </div>
                {form.inventoryItemId && (() => {
                  const item = invItems.find(i => i.id === form.inventoryItemId);
                  if (!item) return null;
                  const qty = parseFloat(form.quantity) || 0;
                  const inStock = item.currentStock >= qty;
                  const partial = item.currentStock > 0 && item.currentStock < qty;
                  return (
                    <div className={`text-[9px] mt-0.5 font-bold ${inStock ? 'text-green-600' : partial ? 'text-amber-600' : 'text-red-600'}`}>
                      In Stock: {item.currentStock} {item.unit}
                      {inStock && ' — available from warehouse'}
                      {partial && ` — ${item.currentStock} from warehouse, ${qty - item.currentStock} needs purchase`}
                      {!inStock && item.currentStock === 0 && ' — not in stock, full purchase needed'}
                    </div>
                  );
                })()}
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Qty / Unit</label>
                <div className="flex gap-2">
                  <input className="flex-1 border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 outline-none" type="number" step="any" placeholder="Qty" value={form.quantity}
                    onChange={e => setForm({ ...form, quantity: e.target.value })} />
                  <select className="w-28 border border-slate-300 px-2.5 py-1.5 text-xs outline-none" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                    <optgroup label="Goods">{GOODS_UNITS.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>
                    <optgroup label="Service">{SERVICE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>
                  </select>
                </div>
              </div>
            </div>

            {/* Row 2: Who is requesting */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Department *</label>
                <select className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" value={form.department} onChange={e => setForm({ ...form, department: e.target.value })}>
                  <option value="">Select department</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Person Name</label>
                <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" placeholder="Who needs this?" value={form.requestedByPerson || ''} onChange={e => setForm({ ...form, requestedByPerson: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Urgency</label>
                <select className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })}>
                  {URGENCIES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
            </div>

            {/* Row 3: Supplier (search from vendor master) + Cost */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="relative">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Supplier (search vendors)</label>
                <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" placeholder="Type to search suppliers..."
                  value={form.supplier} onChange={e => { setForm({ ...form, supplier: e.target.value }); }}
                  onFocus={e => (e.target as HTMLInputElement).setAttribute('data-open', '1')}
                  onBlur={e => setTimeout(() => (e.target as HTMLInputElement).removeAttribute('data-open'), 200)}
                />
                {form.supplier && form.supplier.length >= 2 && (() => {
                  const q = form.supplier.toLowerCase();
                  const vendorMatches = vendors.filter(v => v.name.toLowerCase().includes(q)).slice(0, 5);
                  if (vendorMatches.length === 0) return null;
                  return (
                    <div className="absolute z-10 w-full bg-white border border-slate-300 shadow-lg max-h-32 overflow-y-auto mt-0.5">
                      {vendorMatches.map((v, i) => (
                        <div key={i} className="px-2.5 py-1.5 text-xs hover:bg-blue-50 cursor-pointer border-b border-slate-100"
                          onMouseDown={() => setForm(f => ({ ...f, supplier: v.name, supplierPhone: v.phone || f.supplierPhone }))}>
                          <span className="text-slate-800 font-medium">{v.name}</span>
                          {v.phone && <span className="text-slate-400 ml-2">{v.phone}</span>}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Supplier Phone</label>
                <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" placeholder="Phone (optional)" value={form.supplierPhone} onChange={e => setForm({ ...form, supplierPhone: e.target.value })} />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Estimated Cost/Unit (Rs)</label>
                <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" type="number" step="any" placeholder="Cost per unit" value={form.estimatedCost} onChange={e => setForm({ ...form, estimatedCost: e.target.value })} />
              </div>
            </div>

            {/* Row 4: Category + Justification */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Category</label>
                <select className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
                  <optgroup label="Goods / Material">{GOODS_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</optgroup>
                  <optgroup label="Service / Contract">{SERVICE_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</optgroup>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Justification / Remarks</label>
                <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" placeholder="Why is this needed?" value={form.justification} onChange={e => setForm({ ...form, justification: e.target.value })} />
              </div>
            </div>

            {/* Hidden title — auto-generated */}
            <input type="hidden" value={form.title || `Need ${form.itemName}`} />
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
              <textarea
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                rows={2}
                placeholder="Additional Remarks"
                value={form.remarks}
                onChange={e => setForm({ ...form, remarks: e.target.value })}
              />
            </div>
            <button
              type="submit"
              disabled={saving}
              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:bg-slate-400 w-full md:w-auto uppercase tracking-wide"
            >
              {saving ? 'Submitting...' : 'Submit Request'}
            </button>
          </form>
        </div>
      )}

      {/* Bulk Entry (Excel-style grid) */}
      {tab === 'bulk' && (
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-slate-100 border-b border-slate-300 px-4 py-2 flex items-center justify-between">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-700">Bulk Indent Entry — add multiple items at once</h3>
            <div className="text-[10px] text-slate-500">{bulkRows.filter(r => r.itemName.trim()).length} / {bulkRows.length} rows filled</div>
          </div>

          {/* Shared context — applies to every row unless overridden */}
          <div className="bg-slate-50 border-b border-slate-300 px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Department *</label>
              <select className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none bg-white" value={bulkCommon.department} onChange={e => setBulkCommon(c => ({ ...c, department: e.target.value }))}>
                <option value="">Select department</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Requested By (Person)</label>
              <input className="w-full border border-slate-300 px-2.5 py-1.5 text-xs outline-none" placeholder="Who needs this?" value={bulkCommon.requestedByPerson} onChange={e => setBulkCommon(c => ({ ...c, requestedByPerson: e.target.value }))} />
            </div>
            <div className="text-[10px] text-slate-500 self-end pb-1">
              Tip: Tab to move between cells. Each row becomes one indent — all will be submitted together.
            </div>
          </div>

          {/* Grid */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs min-w-[1100px]">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-8">#</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 min-w-[240px]">Item *</th>
                  <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Qty *</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Unit</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-28">Category</th>
                  <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Cost/Unit</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Urgency</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 min-w-[160px]">Supplier</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 min-w-[160px]">Justification</th>
                  <th className="text-center px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest w-16">Actions</th>
                </tr>
              </thead>
              <tbody>
                {bulkRows.map((row, i) => {
                  const showDropdown = bulkFocused === i && row.itemQuery.length >= 2;
                  const matches = showDropdown ? invItems.filter(it => it.name.toLowerCase().includes(row.itemQuery.toLowerCase()) || it.code.toLowerCase().includes(row.itemQuery.toLowerCase())).slice(0, 8) : [];
                  const qty = parseFloat(row.quantity) || 0;
                  const cost = parseFloat(row.estimatedCost) || 0;
                  const total = qty * cost;
                  return (
                    <tr key={i} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/60' : 'bg-white'}`}>
                      <td className="px-2 py-0.5 text-slate-400 font-mono tabular-nums border-r border-slate-100 text-center">{i + 1}</td>
                      <td className="px-1 py-0.5 border-r border-slate-100 relative">
                        <input
                          className="w-full border-0 px-1.5 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent"
                          placeholder="Type to search or enter new..."
                          value={row.itemQuery}
                          onChange={e => updateBulkRow(i, { itemQuery: e.target.value, itemName: e.target.value, inventoryItemId: '' })}
                          onFocus={() => setBulkFocused(i)}
                          onBlur={() => setTimeout(() => setBulkFocused(f => f === i ? null : f), 200)}
                        />
                        {showDropdown && matches.length > 0 && (
                          <div className="absolute z-20 left-0 right-0 top-full bg-white border border-slate-300 shadow-lg max-h-40 overflow-y-auto">
                            {matches.map(it => (
                              <div key={it.id} className="px-2 py-1 text-xs hover:bg-blue-50 cursor-pointer border-b border-slate-100 flex justify-between"
                                onMouseDown={() => pickItemForBulk(i, it)}>
                                <span className="text-slate-800 font-medium">{it.name}</span>
                                <span className="text-slate-400 text-[10px]">{it.code} | {it.currentStock} {it.unit}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="px-1 py-0.5 border-r border-slate-100">
                        <input type="number" step="any" className="w-full border-0 px-1.5 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent text-right font-mono tabular-nums"
                          value={row.quantity} onChange={e => updateBulkRow(i, { quantity: e.target.value })} />
                      </td>
                      <td className="px-1 py-0.5 border-r border-slate-100">
                        <select className="w-full border-0 px-1 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent" value={row.unit} onChange={e => updateBulkRow(i, { unit: e.target.value })}>
                          <optgroup label="Goods">{GOODS_UNITS.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>
                          <optgroup label="Service">{SERVICE_UNITS.map(u => <option key={u} value={u}>{u}</option>)}</optgroup>
                        </select>
                      </td>
                      <td className="px-1 py-0.5 border-r border-slate-100">
                        <select className="w-full border-0 px-1 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent" value={row.category} onChange={e => updateBulkRow(i, { category: e.target.value })}>
                          <optgroup label="Goods">{GOODS_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</optgroup>
                          <optgroup label="Service">{SERVICE_CATEGORIES.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</optgroup>
                        </select>
                      </td>
                      <td className="px-1 py-0.5 border-r border-slate-100">
                        <input type="number" step="any" className="w-full border-0 px-1.5 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent text-right font-mono tabular-nums"
                          value={row.estimatedCost} onChange={e => updateBulkRow(i, { estimatedCost: e.target.value })} />
                      </td>
                      <td className="px-1 py-0.5 border-r border-slate-100">
                        <select className="w-full border-0 px-1 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent" value={row.urgency} onChange={e => updateBulkRow(i, { urgency: e.target.value })}>
                          {URGENCIES.map(u => <option key={u} value={u}>{u}</option>)}
                        </select>
                      </td>
                      <td className="px-1 py-0.5 border-r border-slate-100">
                        <input className="w-full border-0 px-1.5 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent"
                          placeholder="Supplier (optional)" list={`vendor-list-${i}`} value={row.supplier} onChange={e => updateBulkRow(i, { supplier: e.target.value })} />
                        <datalist id={`vendor-list-${i}`}>
                          {vendors.map((v, vi) => <option key={vi} value={v.name} />)}
                        </datalist>
                      </td>
                      <td className="px-1 py-0.5 border-r border-slate-100">
                        <input className="w-full border-0 px-1.5 py-1 text-xs outline-none focus:bg-blue-50 bg-transparent"
                          placeholder="Why needed?" value={row.justification} onChange={e => updateBulkRow(i, { justification: e.target.value })} />
                      </td>
                      <td className="px-1 py-0.5 text-center">
                        <button onClick={() => copyBulkRow(i)} className="text-slate-400 hover:text-blue-600 mx-0.5" title="Copy row"><Copy size={12} /></button>
                        <button onClick={() => deleteBulkRow(i)} className="text-slate-400 hover:text-red-600 mx-0.5" title="Delete row"><Trash2 size={12} /></button>
                        {total > 0 && <div className="text-[9px] text-slate-400 font-mono tabular-nums mt-0.5">Rs.{total.toLocaleString('en-IN')}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100 border-t-2 border-slate-400">
                  <td colSpan={9} className="px-2 py-1.5 text-right text-[10px] font-bold text-slate-600 uppercase tracking-widest">Grand Total</td>
                  <td className="px-2 py-1.5 text-center text-xs font-bold text-slate-800 font-mono tabular-nums">
                    Rs.{bulkRows.reduce((s, r) => s + (parseFloat(r.quantity) || 0) * (parseFloat(r.estimatedCost) || 0), 0).toLocaleString('en-IN')}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Bulk footer actions */}
          <div className="bg-slate-50 border-t border-slate-300 px-4 py-2.5 flex items-center justify-between">
            <button onClick={addBulkRow} className="px-3 py-1 bg-white border border-slate-400 text-slate-700 text-[11px] font-medium hover:bg-slate-100 flex items-center gap-1">
              <Plus size={12} /> Add Row
            </button>
            <div className="flex gap-2">
              <button onClick={() => { setBulkRows([blankRow(), blankRow(), blankRow()]); setBulkCommon({ department: '', requestedByPerson: '' }); }}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                Reset
              </button>
              <button onClick={submitBulk} disabled={bulkSaving}
                className="px-4 py-1 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-wide hover:bg-blue-700 disabled:bg-slate-400">
                {bulkSaving ? 'Submitting...' : `Submit All (${bulkRows.filter(r => r.itemName.trim() && parseFloat(r.quantity) > 0).length})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Requisition List */}
      {tab === 'list' && (
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6">
          {reqs.length === 0 && (
            <div className="p-8 text-center text-xs text-slate-400">No requisitions found</div>
          )}
          {reqs.map(pr => {
            const isExpanded = expanded === pr.id;
            const totalCost = pr.quantity * pr.estimatedCost;
            return (
              <div key={pr.id} className="border-b border-slate-200 last:border-b-0">
                <div
                  className={`px-4 py-2.5 flex items-start gap-3 cursor-pointer hover:bg-blue-50/60 transition ${
                    isExpanded ? 'bg-slate-50' : 'even:bg-slate-50/70'
                  }`}
                  onClick={() => {
                    const next = isExpanded ? null : pr.id;
                    setExpanded(next);
                    setStockCheck(null);
                    setItemHistory(null);
                    if (next) {
                      if (pr.inventoryItemId && ['DRAFT', 'SUBMITTED', 'APPROVED'].includes(pr.status)) {
                        checkStock(pr.id, pr.quantity);
                      }
                      if (pr.inventoryItemId) {
                        fetchItemHistory(pr.inventoryItemId);
                      }
                    }
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-800">#{pr.reqNo} {pr.title}</span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${URG_COLORS[pr.urgency]}`}>{pr.urgency}</span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_COLORS[pr.status]}`}>{pr.status}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                      <span>{pr.itemName} -- {pr.quantity} {pr.unit}</span>
                      <span className="font-mono tabular-nums">Rs.{totalCost.toLocaleString()}</span>
                      {pr.department && <span className="text-[9px] px-1 py-0 border border-slate-300 bg-slate-100 font-bold uppercase">{pr.department}</span>}
                      {pr.issuedQty > 0 && <span className="text-[9px] text-green-700 font-bold">{pr.issuedQty} issued</span>}
                      {pr.purchaseQty > 0 && <span className="text-[9px] text-amber-600 font-bold">{pr.purchaseQty} to buy</span>}
                      <span className="text-slate-400">{pr.requestedBy} | {new Date(pr.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp size={16} className="text-slate-400 mt-0.5" /> : <ChevronDown size={16} className="text-slate-400 mt-0.5" />}
                </div>

                {isExpanded && (
                  <div className="border-t border-slate-200 px-4 py-3 space-y-3 bg-slate-50">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Item</span>
                        <div className="font-medium text-slate-800">{pr.itemName}</div>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Qty</span>
                        <div className="font-medium text-slate-800">{pr.quantity} {pr.unit}</div>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Cost/Unit</span>
                        <div className="font-medium text-slate-800 font-mono tabular-nums">Rs.{pr.estimatedCost}</div>
                      </div>
                      <div>
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Total</span>
                        <div className="font-bold text-slate-900 font-mono tabular-nums">Rs.{totalCost.toLocaleString()}</div>
                      </div>
                    </div>

                    {pr.justification && (
                      <div className="text-xs text-slate-700">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Justification: </span>
                        {pr.justification}
                      </div>
                    )}
                    {pr.remarks && (
                      <div className="text-xs text-slate-500">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Remarks: </span>
                        {pr.remarks}
                      </div>
                    )}
                    {pr.approvedBy && (
                      <div className="text-xs text-green-700 flex items-center gap-1">
                        <Check size={12} /> Approved by {pr.approvedBy} on {new Date(pr.approvedAt!).toLocaleDateString()}
                      </div>
                    )}
                    {pr.rejectionReason && (
                      <div className="text-xs text-red-700 flex items-center gap-1">
                        <X size={12} /> Rejected: {pr.rejectionReason}
                      </div>
                    )}
                    {pr.issuedQty > 0 && (
                      <div className="text-xs text-green-700 flex items-center gap-1">
                        <Check size={12} /> {pr.issuedQty} {pr.unit} issued from warehouse {pr.issuedBy ? `by ${pr.issuedBy}` : ''} {pr.issuedAt ? `on ${new Date(pr.issuedAt).toLocaleDateString()}` : ''}
                      </div>
                    )}
                    {pr.purchaseQty > 0 && ['PO_PENDING', 'ORDERED'].includes(pr.status) && (
                      <div className="text-xs text-amber-600 font-bold">
                        {pr.purchaseQty} {pr.unit} pending purchase
                      </div>
                    )}
                    {pr.department && (
                      <div className="text-[10px] text-slate-500">Dept: <span className="font-bold">{pr.department}</span> {pr.requestedByPerson ? `| Person: ${pr.requestedByPerson}` : ''}</div>
                    )}

                    {/* ── Vendor & Quote Tracking ── */}
                    <div className="border border-slate-300 bg-white p-3 space-y-2" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-between">
                        <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Vendor / Quote</div>
                        {pr.vendor && pr.quoteRequestedAt && (
                          <span className="text-[9px] text-slate-500">
                            Requested {new Date(pr.quoteRequestedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })}
                            {pr.quoteRequestedBy ? ` by ${pr.quoteRequestedBy}` : ''}
                          </span>
                        )}
                      </div>

                      {pr.vendor ? (
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div>
                            <div className="text-[10px] text-slate-400 uppercase tracking-widest">Vendor</div>
                            <div className="text-xs font-bold text-slate-800">{pr.vendor.name}</div>
                            <div className="text-[10px] text-slate-500">
                              {pr.vendor.email || 'no email'} {pr.vendor.phone ? `| ${pr.vendor.phone}` : ''}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400 uppercase tracking-widest">Quoted Rate</div>
                            {pr.vendorRate != null && pr.vendorRate > 0 ? (
                              <>
                                <div className="text-sm font-bold text-green-700 font-mono tabular-nums">Rs.{pr.vendorRate.toLocaleString('en-IN')}</div>
                                <div className="text-[10px] text-slate-500">
                                  {pr.quoteSource || 'MANUAL'} · {pr.vendorQuotedAt && new Date(pr.vendorQuotedAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}
                                </div>
                              </>
                            ) : (
                              <div className="flex gap-1">
                                <input type="number" step="any" placeholder="Enter rate" value={quoteRateInput[pr.id] || ''}
                                  onChange={e => setQuoteRateInput(prev => ({ ...prev, [pr.id]: e.target.value }))}
                                  className="border border-slate-300 px-2 py-1 text-xs w-24 font-mono tabular-nums" />
                                <button onClick={() => handleSaveQuoteRate(pr.id)}
                                  className="px-2 py-1 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">Save</button>
                              </div>
                            )}
                          </div>
                          <div>
                            <div className="text-[10px] text-slate-400 uppercase tracking-widest">Total (Qty × Rate)</div>
                            <div className="text-sm font-bold text-slate-800 font-mono tabular-nums">
                              {pr.vendorRate ? `Rs.${(pr.vendorRate * pr.quantity).toLocaleString('en-IN')}` : '—'}
                            </div>
                          </div>
                          {pr.vendorRate != null && pr.vendorRate > 0 && (
                            <div className="md:col-span-3 flex items-center gap-2 pt-1">
                              <input type="number" step="any" placeholder="Update rate" value={quoteRateInput[pr.id] || ''}
                                onChange={e => setQuoteRateInput(prev => ({ ...prev, [pr.id]: e.target.value }))}
                                className="border border-slate-300 px-2 py-1 text-xs w-28 font-mono tabular-nums" />
                              <input placeholder="Remarks" value={quoteRemarksInput[pr.id] || ''}
                                onChange={e => setQuoteRemarksInput(prev => ({ ...prev, [pr.id]: e.target.value }))}
                                className="border border-slate-300 px-2 py-1 text-xs flex-1" />
                              <button onClick={() => handleSaveQuoteRate(pr.id)}
                                className="px-2 py-1 bg-white border border-blue-500 text-blue-700 text-[10px] font-medium hover:bg-blue-50">Update Rate</button>
                              <button onClick={() => setSelectVendorFor(pr.id)}
                                className="px-2 py-1 bg-white border border-slate-400 text-slate-700 text-[10px] font-medium hover:bg-slate-50">Change Vendor</button>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <div className="text-xs text-slate-500">
                            {pr.supplier ? `Preferred supplier: ${pr.supplier}` : 'No vendor selected yet'}
                          </div>
                          <button onClick={() => setSelectVendorFor(pr.id)}
                            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
                            Select Vendor & Request Quote
                          </button>
                        </div>
                      )}
                    </div>

                    {/* ── Item History: past POs + rate stats ── */}
                    {pr.inventoryItemId && (
                      <div className="border border-slate-300 bg-white p-3 space-y-2" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Past Orders for this Item</div>
                          {itemHistory?.stats && (
                            <div className="text-[10px] text-slate-500">
                              Last {itemHistory.stats.totalPos} POs · Min Rs.{itemHistory.stats.minRate.toLocaleString('en-IN')} / Avg Rs.{itemHistory.stats.avgRate.toLocaleString('en-IN')} / Max Rs.{itemHistory.stats.maxRate.toLocaleString('en-IN')}
                            </div>
                          )}
                        </div>
                        {historyLoading ? (
                          <div className="text-xs text-slate-400">Loading history...</div>
                        ) : !itemHistory || itemHistory.recent.length === 0 ? (
                          <div className="text-xs text-slate-400 italic">No prior POs found for this item</div>
                        ) : (
                          <div className="overflow-x-auto">
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="bg-slate-100 text-slate-600">
                                  <th className="text-left px-2 py-1 font-semibold">PO#</th>
                                  <th className="text-left px-2 py-1 font-semibold">Date</th>
                                  <th className="text-left px-2 py-1 font-semibold">Vendor</th>
                                  <th className="text-right px-2 py-1 font-semibold">Qty</th>
                                  <th className="text-right px-2 py-1 font-semibold">Rate</th>
                                  <th className="text-left px-2 py-1 font-semibold">Status</th>
                                </tr>
                              </thead>
                              <tbody>
                                {itemHistory.recent.map((h, idx) => (
                                  <tr key={idx} className="border-b border-slate-100">
                                    <td className="px-2 py-1 font-mono tabular-nums text-slate-700">{h.poNo}</td>
                                    <td className="px-2 py-1 text-slate-600">{h.poDate ? new Date(h.poDate).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'}</td>
                                    <td className="px-2 py-1 text-slate-800">{h.vendorName || '—'}</td>
                                    <td className="px-2 py-1 text-right font-mono tabular-nums">{h.quantity} {h.unit}</td>
                                    <td className="px-2 py-1 text-right font-mono tabular-nums font-bold">Rs.{h.rate.toLocaleString('en-IN')}</td>
                                    <td className="px-2 py-1 text-[9px] text-slate-500">{h.status}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Pipeline Status (read-only — approval/issue happens on Store page) */}
                    <div className="flex items-center gap-0 pt-2">
                      {[
                        { label: 'Submitted', done: !['DRAFT'].includes(pr.status) },
                        { label: 'Store Review', done: ['APPROVED', 'PO_PENDING', 'ORDERED', 'RECEIVED', 'COMPLETED'].includes(pr.status) },
                        { label: 'Issued', done: pr.issuedQty > 0, sub: pr.issuedQty > 0 ? `${pr.issuedQty} ${pr.unit}` : '' },
                        { label: 'Purchase', done: ['ORDERED', 'RECEIVED', 'COMPLETED'].includes(pr.status), sub: pr.purchaseQty > 0 ? `${pr.purchaseQty} ${pr.unit}` : '' },
                        { label: 'Done', done: ['RECEIVED', 'COMPLETED'].includes(pr.status) },
                      ].map((step, i) => (
                        <React.Fragment key={step.label}>
                          {i > 0 && <div className={`h-0.5 w-4 ${step.done ? 'bg-green-400' : 'bg-slate-200'}`} />}
                          <div className={`text-center px-2 py-1 border text-[8px] font-bold uppercase tracking-widest ${step.done ? 'border-green-300 bg-green-50 text-green-700' : 'border-slate-200 bg-slate-50 text-slate-400'}`}>
                            {step.label}
                            {step.sub && <div className="text-[9px] font-mono">{step.sub}</div>}
                          </div>
                        </React.Fragment>
                      ))}
                    </div>
                    {/* Store Action Panel — stock check + issue / purchase / reject */}
                    {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(pr.status) && (
                      <div className="border border-slate-300 bg-white p-3 space-y-2" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between">
                          <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Store Stock & Issue</div>
                          <button onClick={() => { setRejectingId(pr.id); setRejectReason(''); }}
                            className="px-2 py-0.5 bg-white border border-red-300 text-red-600 text-[10px] font-medium hover:bg-red-50">Reject</button>
                        </div>
                        {pr.inventoryItemId && stockCheck?.id === pr.id ? (
                          <>
                            <div className="grid grid-cols-3 gap-4 text-xs">
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Available</span>
                                <span className={`font-mono tabular-nums text-sm font-bold ${stockCheck.available > 0 ? 'text-green-700' : 'text-red-600'}`}>
                                  {stockCheck.available} {stockCheck.unit}
                                </span>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Requested</span>
                                <span className="font-mono tabular-nums text-sm font-bold text-slate-800">{stockCheck.requested} {stockCheck.unit}</span>
                              </div>
                              <div>
                                <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Verdict</span>
                                {stockCheck.available >= stockCheck.requested ? (
                                  <span className="text-sm font-bold text-green-700">In Stock</span>
                                ) : stockCheck.available > 0 ? (
                                  <span className="text-sm font-bold text-amber-600">Partial — need {stockCheck.shortfall} more</span>
                                ) : (
                                  <span className="text-sm font-bold text-red-600">Not in Stock</span>
                                )}
                              </div>
                            </div>
                            <div className="flex items-end gap-3">
                              <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Issue Qty</label>
                                <input type="number" min={0} max={Math.min(stockCheck.available, stockCheck.requested)} value={issueQty}
                                  onChange={e => setIssueQty(String(Math.max(0, Math.min(Number(e.target.value), Math.min(stockCheck.available, stockCheck.requested)))))}
                                  className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-28 font-mono tabular-nums" />
                              </div>
                              <div className="text-xs text-slate-500 pb-1.5">
                                {Number(issueQty) > 0 && <span className="text-green-700 font-medium">{issueQty} from store</span>}
                                {Number(issueQty) > 0 && stockCheck.requested > Number(issueQty) && <span> + </span>}
                                {stockCheck.requested > Number(issueQty) && <span className="text-purple-700 font-medium">{stockCheck.requested - Number(issueQty)} to purchase</span>}
                              </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                              <button onClick={() => handleIssue(pr.id)} disabled={issuing}
                                className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-50">
                                {pr.status !== 'APPROVED' ? 'Approve & Issue' : 'Issue from Store'}
                              </button>
                              <button onClick={() => handleFullPurchase(pr.id)} disabled={issuing}
                                className="px-3 py-1 bg-purple-600 text-white text-[11px] font-medium hover:bg-purple-700 disabled:opacity-50">
                                Approve & Send to Purchase
                              </button>
                            </div>
                          </>
                        ) : pr.inventoryItemId ? (
                          <div className="text-xs text-slate-400">Checking stock…</div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <div className="text-xs text-slate-500">No inventory item linked — service / one-off indent</div>
                            <button onClick={() => handleFullPurchase(pr.id)} disabled={issuing}
                              className="px-3 py-1 bg-purple-600 text-white text-[11px] font-medium hover:bg-purple-700 disabled:opacity-50">
                              Approve & Send to Purchase
                            </button>
                          </div>
                        )}
                      </div>
                    )}

                    {/* PO_PENDING → Create PO / Mark Ordered */}
                    {pr.status === 'PO_PENDING' && (
                      <div className="flex gap-2 pt-1" onClick={e => e.stopPropagation()}>
                        <a href={`/procurement/purchase-orders?newPO=1&item=${encodeURIComponent(pr.itemName)}&qty=${pr.purchaseQty}&unit=${encodeURIComponent(pr.unit)}&requisitionId=${pr.id}`}
                          className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">Create PO</a>
                        <button onClick={() => handleMarkOrdered(pr.id)}
                          className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Mark Ordered</button>
                      </div>
                    )}

                    {/* ORDERED → Mark Received */}
                    {pr.status === 'ORDERED' && (
                      <div className="pt-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => handleMarkReceived(pr.id)}
                          className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">Mark Received</button>
                      </div>
                    )}

                    {/* REJECTED → Resubmit */}
                    {pr.status === 'REJECTED' && (
                      <div className="pt-1" onClick={e => e.stopPropagation()}>
                        <button onClick={() => updateStatus(pr.id, 'DRAFT')}
                          className="px-3 py-1 border border-slate-400 bg-white text-slate-700 text-[11px] font-medium hover:bg-slate-100">Resubmit (→ Draft)</button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Vendor Selection Modal — for Request Quote */}
      {selectVendorFor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => { setSelectVendorFor(null); setVendorQuery(''); }}>
          <div className="bg-white shadow-2xl w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <h2 className="text-xs font-bold uppercase tracking-widest">Select Vendor & Request Quote</h2>
              <button onClick={() => { setSelectVendorFor(null); setVendorQuery(''); }} className="text-slate-400 hover:text-white text-xs">✕</button>
            </div>
            <div className="p-4 space-y-3">
              <input
                type="text"
                value={vendorQuery}
                onChange={e => setVendorQuery(e.target.value)}
                placeholder="Search vendor name, email, or phone..."
                autoFocus
                className="w-full border border-slate-300 px-3 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <div className="max-h-80 overflow-y-auto border border-slate-200">
                {(() => {
                  const q = vendorQuery.toLowerCase().trim();
                  const matches = q.length === 0
                    ? vendors.slice(0, 50)
                    : vendors.filter(v => v.name.toLowerCase().includes(q) || (v.email || '').toLowerCase().includes(q) || (v.phone || '').includes(q)).slice(0, 50);
                  if (matches.length === 0) {
                    return <div className="px-3 py-6 text-center text-xs text-slate-400">No vendors match your search</div>;
                  }
                  return matches.map(v => (
                    <div key={v.id}
                      className="px-3 py-2 text-xs border-b border-slate-100 hover:bg-blue-50 cursor-pointer flex items-center justify-between"
                      onClick={() => handleRequestQuote(selectVendorFor, v)}>
                      <div>
                        <div className="font-bold text-slate-800">{v.name}</div>
                        <div className="text-[10px] text-slate-500">
                          {v.email || <span className="text-red-500 italic">no email</span>}
                          {v.phone ? ` · ${v.phone}` : ''}
                        </div>
                      </div>
                      <button className="px-2 py-1 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">
                        {v.email ? 'Email Quote Request' : 'Mark Requested'}
                      </button>
                    </div>
                  ));
                })()}
              </div>
              <div className="text-[10px] text-slate-500">
                Tip: Indent is for one vendor. If you want quotes from multiple vendors, create separate indents (or ask Saif to enable the multi-vendor RFQ flow).
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reject Modal */}
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
                placeholder="Enter reason..." />
              <div className="flex justify-end gap-2">
                <button onClick={() => { setRejectingId(null); setRejectReason(''); }}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
                <button onClick={handleReject} disabled={!rejectReason.trim()}
                  className="px-3 py-1 bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 disabled:opacity-50">Confirm Reject</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
