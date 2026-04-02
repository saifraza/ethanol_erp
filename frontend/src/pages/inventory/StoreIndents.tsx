import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface PR {
  id: string;
  reqNo: number;
  title: string;
  itemName: string;
  quantity: number;
  unit: string;
  estimatedCost: number;
  urgency: string;
  category: string;
  status: string;
  department: string | null;
  requestedByPerson: string | null;
  requestedBy: string;
  supplier: string | null;
  issuedQty: number;
  purchaseQty: number;
  issuedBy: string | null;
  issuedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

interface Stats {
  DRAFT: number;
  SUBMITTED: number;
  APPROVED: number;
  ISSUED: number;
  PO_PENDING: number;
}

interface StockCheck {
  available: number;
  requested: number;
  canFulfillFromStock: boolean;
  shortfall: number;
  unit: string;
}

interface AutoPOResult {
  created: boolean;
  poId?: string;
  poNo?: number;
  vendorName?: string;
  rate?: number;
  quantity?: number;
  grandTotal?: number;
  reason?: string;
}

interface IssueResult {
  issuedQty: number;
  purchaseQty: number;
  status: string;
  autoPO: AutoPOResult | null;
}

const STATUS_TABS = ['ALL', 'DRAFT', 'SUBMITTED', 'APPROVED', 'PO_PENDING', 'COMPLETED'] as const;

const urgencyStyle: Record<string, string> = {
  ROUTINE: 'border-slate-400 text-slate-700 bg-slate-50',
  SOON: 'border-blue-500 text-blue-700 bg-blue-50',
  URGENT: 'border-orange-500 text-orange-700 bg-orange-50',
  EMERGENCY: 'border-red-600 text-red-700 bg-red-50',
};

const statusStyle: Record<string, string> = {
  DRAFT: 'border-slate-400 text-slate-600 bg-slate-50',
  SUBMITTED: 'border-yellow-500 text-yellow-700 bg-yellow-50',
  APPROVED: 'border-blue-500 text-blue-700 bg-blue-50',
  REJECTED: 'border-red-500 text-red-700 bg-red-50',
  PO_PENDING: 'border-purple-500 text-purple-700 bg-purple-50',
  ORDERED: 'border-indigo-500 text-indigo-700 bg-indigo-50',
  RECEIVED: 'border-teal-500 text-teal-700 bg-teal-50',
  COMPLETED: 'border-green-600 text-green-700 bg-green-50',
};

export default function StoreIndents() {
  const [data, setData] = useState<PR[]>([]);
  const [stats, setStats] = useState<Stats>({ DRAFT: 0, SUBMITTED: 0, APPROVED: 0, ISSUED: 0, PO_PENDING: 0 });
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('ALL');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [stockCheck, setStockCheck] = useState<StockCheck | null>(null);
  const [stockLoading, setStockLoading] = useState(false);
  const [issueQty, setIssueQty] = useState<number>(0);
  const [rejectReason, setRejectReason] = useState('');
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [issueResult, setIssueResult] = useState<IssueResult | null>(null);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = activeTab !== 'ALL' ? `?status=${activeTab}` : '';
      const [listRes, statsRes] = await Promise.all([
        api.get<PR[]>(`/purchase-requisition${params}`),
        api.get<Stats>('/purchase-requisition/stats'),
      ]);
      setData((listRes.data as unknown as { requisitions: PR[] }).requisitions || listRes.data as PR[]);
      // API returns { byStatus: {SUBMITTED: N, ...}, ... } — map to flat Stats shape
      const bs = (statsRes.data as any).byStatus || statsRes.data;
      setStats({
        DRAFT: bs.DRAFT || 0,
        SUBMITTED: bs.SUBMITTED || 0,
        APPROVED: bs.APPROVED || 0,
        ISSUED: bs.ISSUED || 0,
        PO_PENDING: bs.PO_PENDING || 0,
      });
    } catch (err) {
      console.error('Failed to fetch indents:', err);
    } finally {
      setLoading(false);
    }
  }, [activeTab]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fetchStockCheck = useCallback(async (id: string) => {
    try {
      setStockLoading(true);
      const res = await api.get<StockCheck>(`/purchase-requisition/${id}/stock-check`);
      setStockCheck(res.data);
      setIssueQty(Math.min(res.data.available, res.data.requested));
    } catch (err) {
      console.error('Stock check failed:', err);
      setStockCheck(null);
    } finally {
      setStockLoading(false);
    }
  }, []);

  const toggleExpand = useCallback((id: string, status: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setStockCheck(null);
      return;
    }
    setExpandedId(id);
    setStockCheck(null);
    if (['DRAFT', 'SUBMITTED', 'APPROVED'].includes(status)) {
      fetchStockCheck(id);
    }
  }, [expandedId, fetchStockCheck]);

  const handleSubmit = async (id: string) => {
    setActionLoading(true);
    try {
      await api.put(`/purchase-requisition/${id}`, { status: 'SUBMITTED' });
      await fetchData();
      setExpandedId(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    setActionLoading(true);
    try {
      await api.put(`/purchase-requisition/${id}`, { status: 'APPROVED' });
      await fetchData();
      setExpandedId(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    if (!showRejectModal || !rejectReason.trim()) return;
    setActionLoading(true);
    try {
      await api.put(`/purchase-requisition/${showRejectModal}`, { status: 'REJECTED', rejectionReason: rejectReason });
      await fetchData();
      setShowRejectModal(null);
      setRejectReason('');
      setExpandedId(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleIssue = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await api.put(`/purchase-requisition/${id}/issue`, { issuedQty: issueQty });
      const { issue, autoPO } = res.data;
      await fetchData();
      if (autoPO || (issue && issue.purchaseQty > 0)) {
        setIssueResult({ issuedQty: issue?.issuedQty ?? issueQty, purchaseQty: issue?.purchaseQty ?? 0, status: issue?.status ?? '', autoPO });
      } else {
        setExpandedId(null);
        setStockCheck(null);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const handleFullPurchase = async (id: string) => {
    setActionLoading(true);
    try {
      const res = await api.put(`/purchase-requisition/${id}/issue`, { issuedQty: 0 });
      const { issue, autoPO } = res.data;
      await fetchData();
      if (autoPO) {
        setIssueResult({ issuedQty: 0, purchaseQty: issue?.purchaseQty ?? 0, status: issue?.status ?? '', autoPO });
      } else {
        setExpandedId(null);
        setStockCheck(null);
      }
    } finally {
      setActionLoading(false);
    }
  };

  const dismissIssueResult = () => {
    setIssueResult(null);
    setExpandedId(null);
    setStockCheck(null);
  };

  const handleMarkOrdered = async (id: string) => {
    setActionLoading(true);
    try {
      await api.put(`/purchase-requisition/${id}`, { status: 'ORDERED' });
      await fetchData();
      setExpandedId(null);
    } finally {
      setActionLoading(false);
    }
  };

  const handleMarkReceived = async (id: string) => {
    setActionLoading(true);
    try {
      await api.put(`/purchase-requisition/${id}`, { status: 'RECEIVED' });
      await fetchData();
      setExpandedId(null);
    } finally {
      setActionLoading(false);
    }
  };

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  const purchaseQtyPreview = stockCheck ? Math.max(0, stockCheck.requested - issueQty) : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">Store Indents</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Review, approve, and issue requisitions</span>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-slate-400">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Draft</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.DRAFT}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-yellow-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Pending</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.SUBMITTED}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-b md:border-b-0 border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Approved</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.APPROVED}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Issued</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.ISSUED}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-purple-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">PO Pending</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{stats.PO_PENDING}</div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex gap-4 overflow-x-auto">
          {STATUS_TABS.map(tab => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setExpandedId(null); }}
              className={`text-[11px] font-bold uppercase tracking-widest pb-1 border-b-2 whitespace-nowrap ${
                activeTab === tab ? 'border-blue-600 text-slate-800' : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab.replace('_', ' ')}
            </button>
          ))}
        </div>

        {/* Auto-PO Result Banner */}
        {issueResult && (
          <div className={`-mx-3 md:-mx-6 border-x border-b px-4 py-3 ${
            issueResult.autoPO?.created
              ? 'bg-green-50 border-green-300'
              : 'bg-amber-50 border-amber-300'
          }`}>
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                {issueResult.issuedQty > 0 && (
                  <div className="text-xs text-green-800 font-medium">
                    Issued {issueResult.issuedQty} from warehouse
                  </div>
                )}
                {issueResult.autoPO?.created ? (
                  <div className="text-xs text-green-800">
                    Draft PO <span className="font-bold">#{issueResult.autoPO.poNo}</span> created for{' '}
                    <span className="font-mono tabular-nums font-bold">{issueResult.autoPO.quantity}</span> units
                    {issueResult.autoPO.vendorName && <> — Vendor: <span className="font-bold">{issueResult.autoPO.vendorName}</span></>}
                    {issueResult.autoPO.rate != null && <> @ Rs.{issueResult.autoPO.rate.toLocaleString('en-IN')}</>}
                    {issueResult.autoPO.grandTotal != null && (
                      <> — Total: <span className="font-mono tabular-nums font-bold">Rs.{issueResult.autoPO.grandTotal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span></>
                    )}
                  </div>
                ) : issueResult.autoPO ? (
                  <div className="text-xs text-amber-800">
                    {issueResult.purchaseQty > 0 && <><span className="font-mono tabular-nums font-bold">{issueResult.purchaseQty}</span> pending purchase — </>}
                    {issueResult.autoPO.reason}
                  </div>
                ) : null}
              </div>
              <div className="flex gap-2 shrink-0">
                {issueResult.autoPO?.created && issueResult.autoPO.poId && (
                  <a
                    href={`/procurement/purchase-orders`}
                    className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
                  >
                    View PO
                  </a>
                )}
                <button
                  onClick={dismissIssueResult}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          <table className="w-full text-xs min-w-[800px]">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-12">#</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Item</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">Qty</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-16">Unit</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Dept</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Person</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Urgency</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-24">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 w-20">Date</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 && (
                <tr><td colSpan={10} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No indents found</td></tr>
              )}
              {data.map((row, i) => (
                <React.Fragment key={row.id}>
                  <tr
                    className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''} ${expandedId === row.id ? 'bg-blue-50' : ''}`}
                    onClick={() => toggleExpand(row.id, row.status)}
                  >
                    <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100 font-mono tabular-nums">{row.reqNo}</td>
                    <td className="px-3 py-1.5 text-slate-800 font-medium border-r border-slate-100">{row.itemName}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{row.quantity}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{row.unit}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{row.department || '--'}</td>
                    <td className="px-3 py-1.5 text-slate-600 border-r border-slate-100">{row.requestedByPerson || '--'}</td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${urgencyStyle[row.urgency] || urgencyStyle.ROUTINE}`}>{row.urgency}</span>
                    </td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusStyle[row.status] || 'border-slate-300 text-slate-600 bg-slate-50'}`}>{row.status.replace('_', ' ')}</span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{fmtDate(row.createdAt)}</td>
                    <td className="px-3 py-1.5 text-center">
                      <span className="text-[10px] text-slate-400">{expandedId === row.id ? 'CLOSE' : 'VIEW'}</span>
                    </td>
                  </tr>

                  {/* Expanded Detail Row */}
                  {expandedId === row.id && (
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <td colSpan={10} className="px-4 py-3">
                        <div className="space-y-3">
                          <div className="flex gap-6 text-xs text-slate-600">
                            <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Title:</span> {row.title}</div>
                            <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Category:</span> {row.category}</div>
                            {row.supplier && <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Supplier:</span> {row.supplier}</div>}
                            {row.estimatedCost > 0 && <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Est. Cost:</span> <span className="font-mono tabular-nums">Rs.{row.estimatedCost.toLocaleString('en-IN')}</span></div>}
                          </div>

                          {/* Unified Issue Panel — for DRAFT, SUBMITTED, and APPROVED */}
                          {['DRAFT', 'SUBMITTED', 'APPROVED'].includes(row.status) && (
                            <div className="border border-slate-300 bg-white p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Store Stock & Issue</div>
                                {['DRAFT', 'SUBMITTED'].includes(row.status) && (
                                  <div className="flex gap-2">
                                    <button onClick={(e) => { e.stopPropagation(); setShowRejectModal(row.id); }} disabled={actionLoading}
                                      className="px-2 py-0.5 bg-white border border-red-300 text-red-600 text-[10px] font-medium hover:bg-red-50 disabled:opacity-50">
                                      Reject
                                    </button>
                                  </div>
                                )}
                              </div>
                              {stockLoading ? (
                                <div className="text-xs text-slate-400">Checking stock...</div>
                              ) : stockCheck ? (
                                <div className="space-y-2">
                                  <div className="grid grid-cols-3 gap-4 text-xs">
                                    <div>
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Available</span>
                                      <span className={`font-mono tabular-nums text-sm font-bold ${stockCheck.available > 0 ? 'text-green-700' : 'text-red-600'}`}>
                                        {stockCheck.available} {stockCheck.unit}
                                      </span>
                                    </div>
                                    <div>
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Requested</span>
                                      <span className="font-mono tabular-nums text-sm font-bold text-slate-800">{stockCheck.requested} {stockCheck.unit}</span>
                                    </div>
                                    <div>
                                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest block">Verdict</span>
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
                                      <input
                                        type="number"
                                        min={0}
                                        max={Math.min(stockCheck.available, stockCheck.requested)}
                                        value={issueQty}
                                        onChange={(e) => setIssueQty(Math.max(0, Math.min(Number(e.target.value), Math.min(stockCheck.available, stockCheck.requested))))}
                                        onClick={(e) => e.stopPropagation()}
                                        className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-28 font-mono tabular-nums"
                                      />
                                    </div>
                                    <div className="text-xs text-slate-500 pb-1.5">
                                      {issueQty > 0 && <span className="text-green-700 font-medium">{issueQty} from store</span>}
                                      {issueQty > 0 && purchaseQtyPreview > 0 && <span> + </span>}
                                      {purchaseQtyPreview > 0 && <span className="text-purple-700 font-medium">{purchaseQtyPreview} to purchase</span>}
                                    </div>
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    <button onClick={(e) => { e.stopPropagation(); handleIssue(row.id); }} disabled={actionLoading}
                                      className="px-3 py-1 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-50">
                                      {row.status !== 'APPROVED' ? 'Approve & Issue' : 'Issue from Store'}
                                    </button>
                                    <button onClick={(e) => { e.stopPropagation(); handleFullPurchase(row.id); }} disabled={actionLoading}
                                      className="px-3 py-1 bg-purple-600 text-white text-[11px] font-medium hover:bg-purple-700 disabled:opacity-50">
                                      Approve & Send to Purchase
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="text-xs text-slate-400">No inventory item linked — <button onClick={(e) => { e.stopPropagation(); handleIssue(row.id); }} disabled={actionLoading} className="text-blue-600 underline">Approve & Complete</button></div>
                              )}
                            </div>
                          )}

                          {/* PO_PENDING Actions */}
                          {row.status === 'PO_PENDING' && (
                            <div className="space-y-2">
                              <div className="flex gap-4 text-xs">
                                {row.issuedQty > 0 && <span className="text-green-700 font-medium">{row.issuedQty} {row.unit} issued from WH</span>}
                                {row.purchaseQty > 0 && <span className="text-purple-700 font-medium">{row.purchaseQty} {row.unit} pending purchase</span>}
                              </div>
                              <div className="flex gap-2">
                                <a
                                  href={`/procurement/purchase-orders?newPO=1&item=${encodeURIComponent(row.itemName)}&qty=${row.purchaseQty}&unit=${encodeURIComponent(row.unit)}&requisitionId=${row.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 inline-block"
                                >
                                  Create PO
                                </a>
                                <button onClick={(e) => { e.stopPropagation(); handleMarkOrdered(row.id); }} disabled={actionLoading}
                                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50">
                                  Mark Ordered
                                </button>
                              </div>
                            </div>
                          )}

                          {/* ORDERED Actions */}
                          {row.status === 'ORDERED' && (
                            <button onClick={(e) => { e.stopPropagation(); handleMarkReceived(row.id); }} disabled={actionLoading}
                              className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                              Mark Received
                            </button>
                          )}

                          {/* COMPLETED / RECEIVED — Read Only */}
                          {(row.status === 'COMPLETED' || row.status === 'RECEIVED') && (
                            <div className="flex gap-6 text-xs text-slate-600">
                              {row.issuedQty > 0 && <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Issued:</span> {row.issuedQty} {row.unit}</div>}
                              {row.issuedBy && <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Issued By:</span> {row.issuedBy}</div>}
                              {row.issuedAt && <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Issued At:</span> {fmtDate(row.issuedAt)}</div>}
                              {row.purchaseQty > 0 && <div><span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Purchased:</span> {row.purchaseQty} {row.unit}</div>}
                            </div>
                          )}

                          {/* REJECTED — Show Reason */}
                          {row.status === 'REJECTED' && row.rejectionReason && (
                            <div className="text-xs text-red-600">
                              <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Rejection Reason:</span> {row.rejectionReason}
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setShowRejectModal(null)}>
          <div className="bg-white shadow-2xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <h2 className="text-xs font-bold uppercase tracking-widest">Reject Indent</h2>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reason for Rejection</label>
                <textarea
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  rows={3}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none"
                  placeholder="Enter reason..."
                />
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => { setShowRejectModal(null); setRejectReason(''); }}
                  className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={handleReject} disabled={actionLoading || !rejectReason.trim()}
                  className="px-3 py-1 bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 disabled:opacity-50">
                  Confirm Reject
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
