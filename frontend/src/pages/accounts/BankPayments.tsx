import React, { useState, useEffect, useCallback } from 'react';
import { Landmark, X, Shield, CheckCircle, XCircle, Send, AlertTriangle, Clock, Eye, Sparkles } from 'lucide-react';
import api from '../../services/api';

// ═══════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════

interface BatchItem {
  id: string;
  beneficiaryName: string;
  beneficiaryAccount: string;
  beneficiaryIfsc: string;
  beneficiaryBank: string;
  amount: number;
  remarks: string;
  status: string;
  utrNumber: string | null;
  failureReason: string | null;
  vendorId: string | null;
  // Enriched fields for checker verification
  invoiceNo: string | null;
  invoiceDate: string | null;
  invoiceTotal: number | null;
  productName: string | null;
  quantity: number | null;
  unit: string | null;
  rate: number | null;
  poNumber: string | null;
  grnNumber: string | null;
}

interface Batch {
  id: string;
  batchNo: number;
  status: string;
  paymentType: string;
  totalAmount: number;
  recordCount: number;
  createdBy: string;
  createdByName: string;
  checkedBy: string | null;
  checkedByName: string | null;
  releasedBy: string | null;
  releasedByName: string | null;
  fileName: string | null;
  sentAt: string | null;
  ackStatus: string | null;
  createdAt: string;
  items: BatchItem[];
  audit?: AuditEntry[];
}

interface AuditEntry {
  id: string;
  action: string;
  userName: string;
  ipAddress: string | null;
  details: string | null;
  createdAt: string;
}

interface OutstandingInvoice {
  id: string;
  vendorInvNo: string;
  netPayable: number;
  balanceAmount: number;
}

interface Outstanding {
  vendor: { id: string; name: string };
  invoices: OutstandingInvoice[];
  totalOutstanding: number;
}

interface Summary {
  draft: number;
  approved: number;
  sent: number;
  completed: number;
  failed: number;
}

interface Config {
  sftpConfigured: boolean;
  encryptionConfigured: boolean;
  mode: string;
  debitAccount: string;
  payerIfsc: string;
}

interface PinStatus {
  hasPin: boolean;
  failedAttempts: number;
  isLocked: boolean;
  lockedUntil: string | null;
}

type TabKey = 'create' | 'approve' | 'release' | 'history';
type HistoryFilter = 'ALL' | 'DRAFT' | 'APPROVED' | 'SENT_TO_BANK' | 'COMPLETED' | 'FAILED';

// ═══════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════

const fmtCurrency = (n: number): string =>
  n === 0 ? '--' : '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 0 });

const fmtDate = (d: string | null): string =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '--';

const fmtDateTime = (d: string | null): string =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '--';

const statusBadge = (status: string): string => {
  switch (status) {
    case 'DRAFT': return 'border-slate-300 bg-slate-50 text-slate-600';
    case 'APPROVED': return 'border-blue-300 bg-blue-50 text-blue-700';
    case 'RELEASED':
    case 'SENT_TO_BANK': return 'border-amber-300 bg-amber-50 text-amber-700';
    case 'COMPLETED': return 'border-green-300 bg-green-50 text-green-700';
    case 'FAILED': return 'border-red-300 bg-red-50 text-red-700';
    case 'REJECTED': return 'border-red-300 bg-red-50 text-red-700';
    default: return 'border-slate-300 bg-slate-50 text-slate-600';
  }
};

// ═══════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════

export default function BankPayments() {
  const [activeTab, setActiveTab] = useState<TabKey>('create');
  const [summary, setSummary] = useState<Summary>({ draft: 0, approved: 0, sent: 0, completed: 0, failed: 0 });
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchSummary = useCallback(async () => {
    try {
      const [sumRes, cfgRes] = await Promise.all([
        api.get<Summary>('/bank-payments/summary'),
        api.get<Config>('/bank-payments/config'),
      ]);
      setSummary(sumRes.data);
      setConfig(cfgRes.data);
    } catch (err) {
      // silent — tabs will show individual errors
    }
  }, []);

  useEffect(() => {
    fetchSummary().finally(() => setLoading(false));
  }, [fetchSummary]);

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'create', label: 'Create Batch' },
    { key: 'approve', label: 'Approve', count: summary.draft },
    { key: 'release', label: 'Release', count: summary.approved },
    { key: 'history', label: 'History' },
  ];

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
            <Landmark className="w-4 h-4" />
            <h1 className="text-sm font-bold tracking-wide uppercase">Bank Payments</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">UBI H2H-STP Direct Banking</span>
          </div>
          <div className="flex items-center gap-2">
            {config && (
              <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${config.sftpConfigured && config.encryptionConfigured ? 'border-green-400 bg-green-900/30 text-green-300' : 'border-amber-400 bg-amber-900/30 text-amber-300'}`}>
                {config.mode === 'LIVE' ? 'LIVE' : 'TEST'} MODE
              </span>
            )}
          </div>
        </div>

        {/* KPI Strip */}
        <div className="grid grid-cols-5 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-slate-400">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Draft</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.draft}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Approved</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.approved}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sent to Bank</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.sent}</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Completed</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.completed}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-red-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Failed</div>
            <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{summary.failed}</div>
          </div>
        </div>

        {/* Tab Bar */}
        <div className="flex gap-6 border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 bg-white">
          {tabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              className={`py-2.5 text-[11px] font-bold uppercase tracking-widest border-b-2 transition-colors ${
                activeTab === t.key
                  ? 'border-blue-600 text-blue-700'
                  : 'border-transparent text-slate-400 hover:text-slate-600'
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="ml-1.5 text-[9px] font-bold px-1.5 py-0.5 bg-blue-600 text-white">{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Tab Content */}
        {activeTab === 'create' && <CreateBatchTab onBatchCreated={fetchSummary} />}
        {activeTab === 'approve' && <ApproveTab onAction={fetchSummary} />}
        {activeTab === 'release' && <ReleaseTab onAction={fetchSummary} />}
        {activeTab === 'history' && <HistoryTab />}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Tab 1: Create Batch
// ═══════════════════════════════════════════════

function CreateBatchTab({ onBatchCreated }: { onBatchCreated: () => void }) {
  const [outstanding, setOutstanding] = useState<Outstanding[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [paymentType, setPaymentType] = useState<'NEFT' | 'RTGS'>('NEFT');
  const [creating, setCreating] = useState(false);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchOutstanding = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<{ outstanding: Outstanding[] }>('/vendor-payments/outstanding');
      setOutstanding(res.data.outstanding || []);
    } catch {
      setError('Failed to load outstanding invoices');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOutstanding(); }, [fetchOutstanding]);

  // Flatten invoices for table
  const rows = outstanding.flatMap((o) =>
    o.invoices.map((inv) => ({
      vendorId: o.vendor.id,
      vendorName: o.vendor.name,
      invoiceId: inv.id,
      vendorInvNo: inv.vendorInvNo,
      netPayable: inv.netPayable,
      balanceAmount: inv.balanceAmount,
    }))
  );

  const allIds = rows.map((r) => r.invoiceId);
  const allSelected = allIds.length > 0 && allIds.every((id) => selectedIds.has(id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(allIds));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedTotal = rows
    .filter((r) => selectedIds.has(r.invoiceId))
    .reduce((sum, r) => sum + r.balanceAmount, 0);

  const handleCreate = async () => {
    if (selectedIds.size === 0) return;
    try {
      setCreating(true);
      setError(null);
      setSuccessMsg(null);
      const res = await api.post<Batch>('/bank-payments/batches', {
        invoiceIds: Array.from(selectedIds),
        paymentType,
      });
      const batch = res.data;
      setSuccessMsg(`Batch #${batch.batchNo} created with ${batch.recordCount} items for ${fmtCurrency(batch.totalAmount)}`);
      setSelectedIds(new Set());
      onBatchCreated();
      fetchOutstanding();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to create batch';
      const axErr = err as { response?: { data?: { error?: string } } };
      setError(axErr.response?.data?.error || msg);
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading outstanding invoices...</div>;
  }

  return (
    <div>
      {/* Messages */}
      {successMsg && (
        <div className="border border-green-300 bg-green-50 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="text-xs text-green-800">{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)}><X className="w-3.5 h-3.5 text-green-600" /></button>
        </div>
      )}
      {error && (
        <div className="border border-red-300 bg-red-50 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-600" />
            <span className="text-xs text-red-800">{error}</span>
          </div>
          <button onClick={() => setError(null)}><X className="w-3.5 h-3.5 text-red-600" /></button>
        </div>
      )}

      {/* Action Bar */}
      {selectedIds.size > 0 && (
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2.5 bg-blue-50 flex items-center justify-between">
          <div className="text-xs text-blue-800">
            <span className="font-bold">{selectedIds.size}</span> invoice{selectedIds.size > 1 ? 's' : ''} selected
            <span className="mx-2 text-blue-300">|</span>
            Total: <span className="font-bold font-mono tabular-nums">{fmtCurrency(selectedTotal)}</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={paymentType}
              onChange={(e) => setPaymentType(e.target.value as 'NEFT' | 'RTGS')}
              className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white"
            >
              <option value="NEFT">NEFT</option>
              <option value="RTGS">RTGS</option>
            </select>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1.5"
            >
              <Send className="w-3.5 h-3.5" />
              {creating ? 'Creating...' : 'Create Bank Payment Batch'}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
        {rows.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 uppercase tracking-widest">No outstanding invoices</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="px-3 py-2 border-r border-slate-700 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="w-3.5 h-3.5 accent-blue-500"
                  />
                </th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Vendor</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoice No</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Invoice Amount</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Balance Due</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr
                  key={r.invoiceId}
                  className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''} ${selectedIds.has(r.invoiceId) ? 'bg-blue-50' : ''}`}
                  onClick={() => toggleOne(r.invoiceId)}
                >
                  <td className="px-3 py-1.5 border-r border-slate-100 text-center">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(r.invoiceId)}
                      onChange={() => toggleOne(r.invoiceId)}
                      onClick={(e) => e.stopPropagation()}
                      className="w-3.5 h-3.5 accent-blue-500"
                    />
                  </td>
                  <td className="px-3 py-1.5 text-slate-800 border-r border-slate-100 font-medium">{r.vendorName}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{r.vendorInvNo || '--'}</td>
                  <td className="px-3 py-1.5 text-right border-r border-slate-100 font-mono tabular-nums text-slate-700">{fmtCurrency(r.netPayable)}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-800 font-medium">{fmtCurrency(r.balanceAmount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-slate-800 text-white font-semibold">
                <td className="px-3 py-2 border-r border-slate-700" colSpan={3}>
                  <span className="text-[10px] uppercase tracking-widest">{rows.length} invoices</span>
                </td>
                <td className="px-3 py-2 text-right border-r border-slate-700 font-mono tabular-nums text-[10px] uppercase tracking-widest">
                  {fmtCurrency(rows.reduce((s, r) => s + r.netPayable, 0))}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[10px] uppercase tracking-widest">
                  {fmtCurrency(rows.reduce((s, r) => s + r.balanceAmount, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Tab 2: Approve
// ═══════════════════════════════════════════════

function ApproveTab({ onAction }: { onAction: () => void }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedBatch, setExpandedBatch] = useState<Batch | null>(null);
  const [remarks, setRemarks] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState<{ verdict: string; score: number; summary: string; checks: Array<{ check: string; status: string; detail: string }>; recommendations: string[] } | null>(null);
  const [aiLoading, setAiLoading] = useState(false);

  const runAiCheck = async (batchId: string) => {
    try {
      setAiLoading(true);
      setAiResult(null);
      const res = await api.post<{ verdict: string; score: number; summary: string; checks: Array<{ check: string; status: string; detail: string }>; recommendations: string[] }>(`/bank-payments/batches/${batchId}/ai-check`);
      setAiResult(res.data);
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { error?: string } } };
      setError(axErr.response?.data?.error || 'AI check failed');
    } finally {
      setAiLoading(false);
    }
  };

  const fetchBatches = useCallback(async () => {
    try {
      setLoading(true);
      const res = await api.get<{ batches: Batch[] }>('/bank-payments/batches', { params: { status: 'DRAFT', limit: 50 } });
      setBatches(res.data.batches || []);
    } catch {
      setError('Failed to load batches');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const expandBatch = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedBatch(null);
      return;
    }
    try {
      const res = await api.get<Batch>(`/bank-payments/batches/${id}`);
      setExpandedBatch(res.data);
      setExpandedId(id);
      setRemarks('');
    } catch {
      setError('Failed to load batch details');
    }
  };

  const handleApprove = async (id: string) => {
    try {
      setActionLoading('approve');
      setError(null);
      await api.post(`/bank-payments/batches/${id}/approve`, { remarks: remarks || undefined });
      setSuccessMsg('Batch approved successfully');
      setExpandedId(null);
      setExpandedBatch(null);
      onAction();
      fetchBatches();
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { error?: string } } };
      setError(axErr.response?.data?.error || 'Failed to approve batch');
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (id: string) => {
    if (!remarks.trim()) {
      setError('Remarks are required for rejection');
      return;
    }
    try {
      setActionLoading('reject');
      setError(null);
      await api.post(`/bank-payments/batches/${id}/reject`, { remarks });
      setSuccessMsg('Batch rejected');
      setExpandedId(null);
      setExpandedBatch(null);
      onAction();
      fetchBatches();
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { error?: string } } };
      setError(axErr.response?.data?.error || 'Failed to reject batch');
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading draft batches...</div>;
  }

  return (
    <div>
      {successMsg && (
        <div className="border border-green-300 bg-green-50 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="text-xs text-green-800">{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)}><X className="w-3.5 h-3.5 text-green-600" /></button>
        </div>
      )}
      {error && (
        <div className="border border-red-300 bg-red-50 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-600" />
            <span className="text-xs text-red-800">{error}</span>
          </div>
          <button onClick={() => setError(null)}><X className="w-3.5 h-3.5 text-red-600" /></button>
        </div>
      )}

      {/* Security Warning */}
      <div className="border-x border-b border-amber-300 bg-amber-50 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-2">
        <Shield className="w-4 h-4 text-amber-600 flex-shrink-0" />
        <span className="text-[11px] text-amber-800">Checker role: You cannot approve batches that you created. A different user must approve.</span>
      </div>

      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        {batches.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 uppercase tracking-widest">No draft batches pending approval</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Batch #</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Created By</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Items</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Total Amount</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Created</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => (
                <React.Fragment key={b.id}>
                  <tr
                    className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''} ${expandedId === b.id ? 'bg-blue-50' : ''}`}
                    onClick={() => expandBatch(b.id)}
                  >
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono tabular-nums font-medium text-slate-800">#{b.batchNo}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{b.createdByName}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{b.paymentType}</span>
                    </td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100 font-mono tabular-nums">{b.recordCount}</td>
                    <td className="px-3 py-1.5 text-right border-r border-slate-100 font-mono tabular-nums font-medium text-slate-800">{fmtCurrency(b.totalAmount)}</td>
                    <td className="px-3 py-1.5 text-slate-500">{fmtDate(b.createdAt)}</td>
                  </tr>
                  {expandedId === b.id && expandedBatch && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <div className="bg-slate-50 border-b border-slate-200">
                          {/* Items sub-table with PO/Invoice details for checker */}
                          <div className="px-4 py-3">
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Payment Items — Verify Details</div>
                            <table className="w-full text-xs border border-slate-200">
                              <thead>
                                <tr className="bg-slate-200">
                                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Beneficiary</th>
                                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Invoice</th>
                                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">PO / GRN</th>
                                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Product</th>
                                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Account</th>
                                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">IFSC</th>
                                  <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Pay Amount</th>
                                  <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Inv Total</th>
                                </tr>
                              </thead>
                              <tbody>
                                {expandedBatch.items.map((item, j) => (
                                  <tr key={item.id} className={`border-b border-slate-100 ${j % 2 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                    <td className="px-2 py-1 border-r border-slate-100 font-medium text-slate-800">{item.beneficiaryName}</td>
                                    <td className="px-2 py-1 border-r border-slate-100 text-slate-700">
                                      <div>{item.invoiceNo || item.remarks || '--'}</div>
                                      {item.invoiceDate && <div className="text-[10px] text-slate-400">{fmtDate(item.invoiceDate)}</div>}
                                    </td>
                                    <td className="px-2 py-1 border-r border-slate-100 text-slate-600">
                                      {item.poNumber && <div className="text-[10px]">PO: {item.poNumber}</div>}
                                      {item.grnNumber && <div className="text-[10px]">GRN: {item.grnNumber}</div>}
                                      {!item.poNumber && !item.grnNumber && <span className="text-slate-300">--</span>}
                                    </td>
                                    <td className="px-2 py-1 border-r border-slate-100 text-slate-600">
                                      {item.productName || '--'}
                                      {item.quantity && item.unit && <div className="text-[10px] text-slate-400">{item.quantity} {item.unit}{item.rate ? ` @ ${fmtCurrency(item.rate)}` : ''}</div>}
                                    </td>
                                    <td className="px-2 py-1 border-r border-slate-100 font-mono text-[10px] text-slate-600">{item.beneficiaryAccount}</td>
                                    <td className="px-2 py-1 border-r border-slate-100 font-mono text-[10px] text-slate-600">{item.beneficiaryIfsc}</td>
                                    <td className="px-2 py-1 text-right border-r border-slate-100 font-mono tabular-nums font-medium">{fmtCurrency(item.amount)}</td>
                                    <td className="px-2 py-1 text-right font-mono tabular-nums text-slate-500">{item.invoiceTotal ? fmtCurrency(item.invoiceTotal) : '--'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                          {/* AI Verification Check */}
                          <div className="px-4 py-3 border-t border-slate-200">
                            {!aiResult && !aiLoading && (
                              <button
                                onClick={() => runAiCheck(b.id)}
                                className="px-3 py-1.5 bg-violet-600 text-white text-[11px] font-medium hover:bg-violet-700 flex items-center gap-1.5"
                              >
                                <Sparkles className="w-3.5 h-3.5" />
                                AI Verification Check
                              </button>
                            )}
                            {aiLoading && (
                              <div className="flex items-center gap-2 text-xs text-violet-600">
                                <Sparkles className="w-4 h-4 animate-pulse" />
                                <span>Running AI audit — checking amounts, bank details, duplicates, anomalies...</span>
                              </div>
                            )}
                            {aiResult && (
                              <div className={`border ${aiResult.verdict === 'PASS' ? 'border-green-300 bg-green-50' : aiResult.verdict === 'WARNING' ? 'border-amber-300 bg-amber-50' : 'border-red-300 bg-red-50'}`}>
                                <div className={`px-3 py-2 flex items-center justify-between ${aiResult.verdict === 'PASS' ? 'bg-green-100' : aiResult.verdict === 'WARNING' ? 'bg-amber-100' : 'bg-red-100'}`}>
                                  <div className="flex items-center gap-2">
                                    <Sparkles className="w-4 h-4" />
                                    <span className="text-[10px] font-bold uppercase tracking-widest">AI Verification</span>
                                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${aiResult.verdict === 'PASS' ? 'border-green-400 bg-green-200 text-green-800' : aiResult.verdict === 'WARNING' ? 'border-amber-400 bg-amber-200 text-amber-800' : 'border-red-400 bg-red-200 text-red-800'}`}>
                                      {aiResult.verdict} — {aiResult.score}/100
                                    </span>
                                  </div>
                                  <button onClick={() => setAiResult(null)} className="text-slate-400 hover:text-slate-600"><X className="w-3.5 h-3.5" /></button>
                                </div>
                                <div className="px-3 py-2">
                                  <div className="text-xs text-slate-800 font-medium mb-2">{aiResult.summary}</div>
                                  <table className="w-full text-xs border border-slate-200 mb-2">
                                    <thead>
                                      <tr className="bg-slate-100">
                                        <th className="text-left px-2 py-1 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-200">Check</th>
                                        <th className="text-center px-2 py-1 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-200 w-16">Status</th>
                                        <th className="text-left px-2 py-1 font-semibold text-[10px] uppercase tracking-widest">Detail</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {aiResult.checks?.map((c, ci) => (
                                        <tr key={ci} className="border-b border-slate-100">
                                          <td className="px-2 py-1 border-r border-slate-100 font-medium text-slate-700">{c.check}</td>
                                          <td className="px-2 py-1 border-r border-slate-100 text-center">
                                            <span className={`text-[9px] font-bold uppercase px-1 py-0.5 border ${c.status === 'OK' ? 'border-green-300 bg-green-50 text-green-700' : c.status === 'WARNING' ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
                                              {c.status}
                                            </span>
                                          </td>
                                          <td className="px-2 py-1 text-slate-600">{c.detail}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                  {aiResult.recommendations?.length > 0 && (
                                    <div>
                                      <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Recommendations</div>
                                      <ul className="list-disc list-inside text-xs text-slate-600 space-y-0.5">
                                        {aiResult.recommendations.map((r, ri) => <li key={ri}>{r}</li>)}
                                      </ul>
                                    </div>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>
                          {/* Approve / Reject */}
                          <div className="px-4 py-3 border-t border-slate-200 flex items-end gap-3">
                            <div className="flex-1">
                              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Remarks</label>
                              <textarea
                                value={remarks}
                                onChange={(e) => setRemarks(e.target.value)}
                                placeholder="Optional for approval, required for rejection"
                                rows={2}
                                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 resize-none"
                              />
                            </div>
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleApprove(b.id)}
                                disabled={actionLoading !== null}
                                className="px-3 py-1.5 bg-green-600 text-white text-[11px] font-medium hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5"
                              >
                                <CheckCircle className="w-3.5 h-3.5" />
                                {actionLoading === 'approve' ? 'Approving...' : 'Approve'}
                              </button>
                              <button
                                onClick={() => handleReject(b.id)}
                                disabled={actionLoading !== null}
                                className="px-3 py-1.5 bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5"
                              >
                                <XCircle className="w-3.5 h-3.5" />
                                {actionLoading === 'reject' ? 'Rejecting...' : 'Reject'}
                              </button>
                            </div>
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Tab 3: Release
// ═══════════════════════════════════════════════

function ReleaseTab({ onAction }: { onAction: () => void }) {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedBatch, setExpandedBatch] = useState<Batch | null>(null);
  const [pin, setPin] = useState('');
  const [pinStatus, setPinStatus] = useState<PinStatus | null>(null);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [releaseResult, setReleaseResult] = useState<{ fileName: string; batchId: string; encrypted: boolean; mode: string } | null>(null);
  const [showSetPin, setShowSetPin] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [currentPin, setCurrentPin] = useState('');
  const [settingPin, setSettingPin] = useState(false);

  const fetchBatches = useCallback(async () => {
    try {
      setLoading(true);
      const [batchRes, pinRes] = await Promise.all([
        api.get<{ batches: Batch[] }>('/bank-payments/batches', { params: { status: 'APPROVED', limit: 50 } }),
        api.get<PinStatus>('/bank-payments/pin/status'),
      ]);
      setBatches(batchRes.data.batches || []);
      setPinStatus(pinRes.data);
    } catch {
      setError('Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const expandBatch = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedBatch(null);
      setReleaseResult(null);
      return;
    }
    try {
      const res = await api.get<Batch>(`/bank-payments/batches/${id}`);
      setExpandedBatch(res.data);
      setExpandedId(id);
      setPin('');
      setReleaseResult(null);
    } catch {
      setError('Failed to load batch details');
    }
  };

  const handleRelease = async (id: string) => {
    if (pin.length !== 6) {
      setError('PIN must be 6 digits');
      return;
    }
    try {
      setReleasing(true);
      setError(null);
      const res = await api.post<{ fileName: string; batchId: string; encrypted: boolean; mode: string }>(`/bank-payments/batches/${id}/release`, { pin });
      setReleaseResult(res.data);
      setSuccessMsg('Batch released to bank successfully');
      setPin('');
      onAction();
      // Refresh batches after a short delay so the released one disappears
      setTimeout(() => fetchBatches(), 1500);
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { error?: string } } };
      setError(axErr.response?.data?.error || 'Failed to release batch');
      // Refresh pin status in case of lockout
      try {
        const pinRes = await api.get<PinStatus>('/bank-payments/pin/status');
        setPinStatus(pinRes.data);
      } catch { /* silent */ }
    } finally {
      setReleasing(false);
    }
  };

  const handleSetPin = async () => {
    if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
      setError('PIN must be exactly 6 digits');
      return;
    }
    if (newPin !== confirmPin) {
      setError('PINs do not match');
      return;
    }
    try {
      setSettingPin(true);
      setError(null);
      await api.post('/bank-payments/pin/set', {
        pin: newPin,
        currentPin: pinStatus?.hasPin ? currentPin : undefined,
      });
      setSuccessMsg('Release PIN set successfully');
      setShowSetPin(false);
      setNewPin('');
      setConfirmPin('');
      setCurrentPin('');
      const pinRes = await api.get<PinStatus>('/bank-payments/pin/status');
      setPinStatus(pinRes.data);
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { error?: string } } };
      setError(axErr.response?.data?.error || 'Failed to set PIN');
    } finally {
      setSettingPin(false);
    }
  };

  if (loading) {
    return <div className="py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading approved batches...</div>;
  }

  return (
    <div>
      {successMsg && (
        <div className="border border-green-300 bg-green-50 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="text-xs text-green-800">{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)}><X className="w-3.5 h-3.5 text-green-600" /></button>
        </div>
      )}
      {error && (
        <div className="border border-red-300 bg-red-50 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-600" />
            <span className="text-xs text-red-800">{error}</span>
          </div>
          <button onClick={() => setError(null)}><X className="w-3.5 h-3.5 text-red-600" /></button>
        </div>
      )}

      {/* Security Warnings */}
      <div className="border-x border-b border-red-300 bg-red-50 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-2">
        <AlertTriangle className="w-4 h-4 text-red-600 flex-shrink-0" />
        <span className="text-[11px] text-red-800 font-medium">STP Warning: Released batches are sent directly to bank for processing. Funds will be debited immediately. This action cannot be reversed.</span>
      </div>

      {/* PIN Status */}
      {pinStatus && !pinStatus.hasPin && (
        <div className="border-x border-b border-amber-300 bg-amber-50 px-4 py-2 -mx-3 md:-mx-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-600" />
            <span className="text-[11px] text-amber-800">Release PIN not set. You must set a PIN before releasing any batch.</span>
          </div>
          <button
            onClick={() => setShowSetPin(true)}
            className="px-3 py-1 bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700"
          >
            Set PIN
          </button>
        </div>
      )}

      {pinStatus && pinStatus.isLocked && (
        <div className="border-x border-b border-red-300 bg-red-50 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-red-600" />
          <span className="text-[11px] text-red-800 font-medium">
            Account locked due to {pinStatus.failedAttempts} failed PIN attempts.
            {pinStatus.lockedUntil && ` Locked until ${fmtDateTime(pinStatus.lockedUntil)}`}
          </span>
        </div>
      )}

      {/* Set PIN Modal */}
      {showSetPin && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white shadow-2xl w-full max-w-sm">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">Set Release PIN</span>
              <button onClick={() => setShowSetPin(false)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 space-y-3">
              {pinStatus?.hasPin && (
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Current PIN</label>
                  <input
                    type="password"
                    maxLength={6}
                    pattern="\d{6}"
                    value={currentPin}
                    onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono tracking-[0.5em] text-center"
                    placeholder="------"
                  />
                </div>
              )}
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">New PIN (6 digits)</label>
                <input
                  type="password"
                  maxLength={6}
                  pattern="\d{6}"
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono tracking-[0.5em] text-center"
                  placeholder="------"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Confirm PIN</label>
                <input
                  type="password"
                  maxLength={6}
                  pattern="\d{6}"
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono tracking-[0.5em] text-center"
                  placeholder="------"
                />
              </div>
              <button
                onClick={handleSetPin}
                disabled={settingPin || newPin.length !== 6 || confirmPin.length !== 6}
                className="w-full px-3 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
              >
                {settingPin ? 'Setting...' : 'Set Release PIN'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Batches Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        {batches.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 uppercase tracking-widest">No approved batches pending release</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Batch #</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Created By</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Approved By</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Items</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Total Amount</th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => (
                <React.Fragment key={b.id}>
                  <tr
                    className={`border-b border-slate-100 hover:bg-blue-50/60 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''} ${expandedId === b.id ? 'bg-blue-50' : ''}`}
                    onClick={() => expandBatch(b.id)}
                  >
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono tabular-nums font-medium text-slate-800">#{b.batchNo}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{b.createdByName}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{b.checkedByName || '--'}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{b.paymentType}</span>
                    </td>
                    <td className="px-3 py-1.5 text-center border-r border-slate-100 font-mono tabular-nums">{b.recordCount}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-medium text-slate-800">{fmtCurrency(b.totalAmount)}</td>
                  </tr>
                  {expandedId === b.id && expandedBatch && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <div className="bg-slate-50 border-b border-slate-200">
                          {/* Items sub-table */}
                          <div className="px-4 py-3">
                            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Payment Items</div>
                            <table className="w-full text-xs border border-slate-200">
                              <thead>
                                <tr className="bg-slate-200">
                                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Beneficiary</th>
                                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Account</th>
                                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">IFSC</th>
                                  <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Bank</th>
                                  <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Amount</th>
                                </tr>
                              </thead>
                              <tbody>
                                {expandedBatch.items.map((item, j) => (
                                  <tr key={item.id} className={`border-b border-slate-100 ${j % 2 ? 'bg-white' : 'bg-slate-50/50'}`}>
                                    <td className="px-2 py-1 border-r border-slate-100 font-medium text-slate-800">{item.beneficiaryName}</td>
                                    <td className="px-2 py-1 border-r border-slate-100 font-mono text-[10px] text-slate-600">{item.beneficiaryAccount}</td>
                                    <td className="px-2 py-1 border-r border-slate-100 font-mono text-[10px] text-slate-600">{item.beneficiaryIfsc}</td>
                                    <td className="px-2 py-1 border-r border-slate-100 text-slate-500">{item.beneficiaryBank || '--'}</td>
                                    <td className="px-2 py-1 text-right font-mono tabular-nums font-medium">{fmtCurrency(item.amount)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>

                          {/* Release Result */}
                          {releaseResult && (
                            <div className="px-4 py-3 border-t border-green-200 bg-green-50">
                              <div className="text-[10px] font-bold text-green-700 uppercase tracking-widest mb-2">Release Successful</div>
                              <div className="grid grid-cols-4 gap-4 text-xs">
                                <div>
                                  <span className="text-[10px] text-slate-500 uppercase">File Name</span>
                                  <div className="font-mono text-slate-800 mt-0.5">{releaseResult.fileName}</div>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 uppercase">Batch ID</span>
                                  <div className="font-mono text-slate-800 mt-0.5">{releaseResult.batchId}</div>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 uppercase">Encrypted</span>
                                  <div className="text-slate-800 mt-0.5">{releaseResult.encrypted ? 'Yes (AES-256-GCM)' : 'No'}</div>
                                </div>
                                <div>
                                  <span className="text-[10px] text-slate-500 uppercase">SFTP Mode</span>
                                  <div className="text-slate-800 mt-0.5">{releaseResult.mode}</div>
                                </div>
                              </div>
                            </div>
                          )}

                          {/* Release Form */}
                          {!releaseResult && (
                            <div className="px-4 py-3 border-t border-slate-200">
                              {pinStatus && !pinStatus.hasPin ? (
                                <div className="flex items-center gap-2 text-amber-700 text-xs">
                                  <AlertTriangle className="w-4 h-4" />
                                  <span>Set your release PIN first before releasing batches.</span>
                                  <button
                                    onClick={() => setShowSetPin(true)}
                                    className="px-2 py-0.5 bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700 ml-2"
                                  >
                                    Set PIN
                                  </button>
                                </div>
                              ) : pinStatus?.isLocked ? (
                                <div className="flex items-center gap-2 text-red-700 text-xs">
                                  <AlertTriangle className="w-4 h-4" />
                                  <span>Account locked. Try again after {pinStatus.lockedUntil ? fmtDateTime(pinStatus.lockedUntil) : 'some time'}.</span>
                                </div>
                              ) : (
                                <div className="flex items-end gap-3">
                                  <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Release PIN</label>
                                    <input
                                      type="password"
                                      maxLength={6}
                                      pattern="\d{6}"
                                      value={pin}
                                      onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                      className="w-40 border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 font-mono tracking-[0.5em] text-center"
                                      placeholder="------"
                                      onKeyDown={(e) => { if (e.key === 'Enter' && pin.length === 6) handleRelease(b.id); }}
                                    />
                                  </div>
                                  <button
                                    onClick={() => handleRelease(b.id)}
                                    disabled={releasing || pin.length !== 6}
                                    className="px-4 py-1.5 bg-red-600 text-white text-[11px] font-bold hover:bg-red-700 disabled:opacity-50 flex items-center gap-1.5"
                                  >
                                    <Send className="w-3.5 h-3.5" />
                                    {releasing ? 'Releasing...' : 'Release to Bank'}
                                  </button>
                                  <button
                                    onClick={() => { setShowSetPin(true); }}
                                    className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                                  >
                                    Change PIN
                                  </button>
                                </div>
                              )}
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
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════
// Tab 4: History
// ═══════════════════════════════════════════════

function HistoryTab() {
  const [batches, setBatches] = useState<Batch[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<HistoryFilter>('ALL');
  const [offset, setOffset] = useState(0);
  const [detailBatch, setDetailBatch] = useState<Batch | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const limit = 50;

  const fetchBatches = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string | number> = { limit, offset };
      if (filter !== 'ALL') params.status = filter;
      const res = await api.get<{ batches: Batch[]; total: number }>('/bank-payments/batches', { params });
      setBatches(res.data.batches || []);
      setTotal(res.data.total || 0);
    } catch {
      setError('Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [filter, offset]);

  useEffect(() => {
    setOffset(0);
  }, [filter]);

  useEffect(() => { fetchBatches(); }, [fetchBatches]);

  const openDetail = async (id: string) => {
    try {
      const res = await api.get<Batch>(`/bank-payments/batches/${id}`);
      setDetailBatch(res.data);
    } catch {
      setError('Failed to load batch details');
    }
  };

  const handleCheckStatus = async () => {
    try {
      setChecking(true);
      setError(null);
      await api.post('/bank-payments/check-status');
      setSuccessMsg('Bank status check completed');
      fetchBatches();
    } catch (err: unknown) {
      const axErr = err as { response?: { data?: { error?: string } } };
      setError(axErr.response?.data?.error || 'Failed to check bank status');
    } finally {
      setChecking(false);
    }
  };

  const filterChips: { key: HistoryFilter; label: string }[] = [
    { key: 'ALL', label: 'All' },
    { key: 'DRAFT', label: 'Draft' },
    { key: 'APPROVED', label: 'Approved' },
    { key: 'SENT_TO_BANK', label: 'Sent' },
    { key: 'COMPLETED', label: 'Completed' },
    { key: 'FAILED', label: 'Failed' },
  ];

  return (
    <div>
      {successMsg && (
        <div className="border border-green-300 bg-green-50 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span className="text-xs text-green-800">{successMsg}</span>
          </div>
          <button onClick={() => setSuccessMsg(null)}><X className="w-3.5 h-3.5 text-green-600" /></button>
        </div>
      )}
      {error && (
        <div className="border border-red-300 bg-red-50 px-4 py-2.5 -mx-3 md:-mx-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <XCircle className="w-4 h-4 text-red-600" />
            <span className="text-xs text-red-800">{error}</span>
          </div>
          <button onClick={() => setError(null)}><X className="w-3.5 h-3.5 text-red-600" /></button>
        </div>
      )}

      {/* Filter Bar */}
      <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2.5 bg-slate-100 flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {filterChips.map((c) => (
            <button
              key={c.key}
              onClick={() => setFilter(c.key)}
              className={`px-2.5 py-1 text-[10px] font-bold uppercase tracking-widest border transition-colors ${
                filter === c.key
                  ? 'bg-slate-800 text-white border-slate-800'
                  : 'bg-white text-slate-500 border-slate-300 hover:bg-slate-50'
              }`}
            >
              {c.label}
            </button>
          ))}
        </div>
        <button
          onClick={handleCheckStatus}
          disabled={checking}
          className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 disabled:opacity-50 flex items-center gap-1.5"
        >
          <Clock className="w-3.5 h-3.5" />
          {checking ? 'Checking...' : 'Check Bank Status'}
        </button>
      </div>

      {/* Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
        ) : batches.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 uppercase tracking-widest">No batches found</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Batch #</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Items</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Created By</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Approved By</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Released By</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Sent At</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">ACK</th>
                <th className="w-8 px-2 py-2 border-r border-slate-700"></th>
              </tr>
            </thead>
            <tbody>
              {batches.map((b, i) => (
                <tr
                  key={b.id}
                  className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}
                >
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono tabular-nums font-medium text-slate-800">#{b.batchNo}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusBadge(b.status)}`}>{b.status.replace(/_/g, ' ')}</span>
                  </td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{b.paymentType}</td>
                  <td className="px-3 py-1.5 text-center border-r border-slate-100 font-mono tabular-nums">{b.recordCount}</td>
                  <td className="px-3 py-1.5 text-right border-r border-slate-100 font-mono tabular-nums font-medium text-slate-800">{fmtCurrency(b.totalAmount)}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{b.createdByName}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{b.checkedByName || '--'}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{b.releasedByName || '--'}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-slate-500">{fmtDate(b.sentAt)}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">
                    {b.ackStatus ? (
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${b.ackStatus === 'ACK' ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
                        {b.ackStatus}
                      </span>
                    ) : (
                      <span className="text-slate-300">--</span>
                    )}
                  </td>
                  <td className="px-2 py-1.5 text-center">
                    <button
                      onClick={() => openDetail(b.id)}
                      className="text-slate-400 hover:text-blue-600"
                      title="View details"
                    >
                      <Eye className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {total > limit && (
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2 bg-white flex items-center justify-between">
          <span className="text-[10px] text-slate-400 uppercase tracking-widest">
            Showing {offset + 1}-{Math.min(offset + limit, total)} of {total}
          </span>
          <div className="flex gap-1">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="px-2.5 py-1 text-[11px] border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30"
            >
              Prev
            </button>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total}
              className="px-2.5 py-1 text-[11px] border border-slate-300 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-30"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detailBatch && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
            {/* Modal Header */}
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <span className="text-xs font-bold uppercase tracking-widest">Batch #{detailBatch.batchNo}</span>
                <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusBadge(detailBatch.status)}`}>
                  {detailBatch.status.replace(/_/g, ' ')}
                </span>
              </div>
              <button onClick={() => setDetailBatch(null)}><X className="w-4 h-4" /></button>
            </div>

            {/* Modal Body */}
            <div className="overflow-y-auto flex-1">
              {/* Summary Row */}
              <div className="grid grid-cols-5 border-b border-slate-200">
                <div className="px-4 py-2.5 border-r border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Type</div>
                  <div className="text-xs font-medium text-slate-800 mt-0.5">{detailBatch.paymentType}</div>
                </div>
                <div className="px-4 py-2.5 border-r border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Amount</div>
                  <div className="text-xs font-bold text-slate-800 mt-0.5 font-mono tabular-nums">{fmtCurrency(detailBatch.totalAmount)}</div>
                </div>
                <div className="px-4 py-2.5 border-r border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Created By</div>
                  <div className="text-xs text-slate-800 mt-0.5">{detailBatch.createdByName}</div>
                </div>
                <div className="px-4 py-2.5 border-r border-slate-200">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Approved By</div>
                  <div className="text-xs text-slate-800 mt-0.5">{detailBatch.checkedByName || '--'}</div>
                </div>
                <div className="px-4 py-2.5">
                  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Released By</div>
                  <div className="text-xs text-slate-800 mt-0.5">{detailBatch.releasedByName || '--'}</div>
                </div>
              </div>
              {detailBatch.fileName && (
                <div className="grid grid-cols-3 border-b border-slate-200">
                  <div className="px-4 py-2 border-r border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">File Name</div>
                    <div className="text-xs font-mono text-slate-800 mt-0.5">{detailBatch.fileName}</div>
                  </div>
                  <div className="px-4 py-2 border-r border-slate-200">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Sent At</div>
                    <div className="text-xs text-slate-800 mt-0.5">{fmtDateTime(detailBatch.sentAt)}</div>
                  </div>
                  <div className="px-4 py-2">
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">ACK Status</div>
                    <div className="text-xs text-slate-800 mt-0.5">
                      {detailBatch.ackStatus ? (
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${detailBatch.ackStatus === 'ACK' ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
                          {detailBatch.ackStatus}
                        </span>
                      ) : '--'}
                    </div>
                  </div>
                </div>
              )}

              {/* Items Table */}
              <div className="px-4 py-3">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Payment Items ({detailBatch.items.length})</div>
                <div className="border border-slate-200 overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-200">
                        <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Beneficiary</th>
                        <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Account</th>
                        <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">IFSC</th>
                        <th className="text-right px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Amount</th>
                        <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Status</th>
                        <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">UTR</th>
                        <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Failure Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailBatch.items.map((item, j) => (
                        <tr key={item.id} className={`border-b border-slate-100 ${j % 2 ? 'bg-white' : 'bg-slate-50/50'}`}>
                          <td className="px-2 py-1 border-r border-slate-100 font-medium text-slate-800">{item.beneficiaryName}</td>
                          <td className="px-2 py-1 border-r border-slate-100 font-mono text-[10px] text-slate-600">{item.beneficiaryAccount}</td>
                          <td className="px-2 py-1 border-r border-slate-100 font-mono text-[10px] text-slate-600">{item.beneficiaryIfsc}</td>
                          <td className="px-2 py-1 text-right border-r border-slate-100 font-mono tabular-nums font-medium">{fmtCurrency(item.amount)}</td>
                          <td className="px-2 py-1 border-r border-slate-100">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusBadge(item.status)}`}>{item.status}</span>
                          </td>
                          <td className="px-2 py-1 border-r border-slate-100 font-mono text-[10px] text-slate-600">{item.utrNumber || '--'}</td>
                          <td className="px-2 py-1 text-red-600">{item.failureReason || '--'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Audit Trail */}
              {detailBatch.audit && detailBatch.audit.length > 0 && (
                <div className="px-4 py-3 border-t border-slate-200">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Audit Trail</div>
                  <div className="border border-slate-200">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-slate-200">
                          <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Timestamp</th>
                          <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">Action</th>
                          <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">User</th>
                          <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-300">IP</th>
                          <th className="text-left px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Details</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detailBatch.audit.map((a, j) => (
                          <tr key={a.id} className={`border-b border-slate-100 ${j % 2 ? 'bg-white' : 'bg-slate-50/50'}`}>
                            <td className="px-2 py-1 border-r border-slate-100 text-slate-500 whitespace-nowrap">{fmtDateTime(a.createdAt)}</td>
                            <td className="px-2 py-1 border-r border-slate-100">
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-600">{a.action}</span>
                            </td>
                            <td className="px-2 py-1 border-r border-slate-100 text-slate-700">{a.userName}</td>
                            <td className="px-2 py-1 border-r border-slate-100 font-mono text-[10px] text-slate-500">{a.ipAddress || '--'}</td>
                            <td className="px-2 py-1 text-slate-600">{a.details || '--'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
