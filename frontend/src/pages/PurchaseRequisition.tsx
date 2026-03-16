import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { ShoppingCart, Plus, Check, X, Clock, ChevronDown, ChevronUp } from 'lucide-react';

const URGENCIES = ['ROUTINE', 'SOON', 'URGENT', 'EMERGENCY'];
const CATEGORIES = ['SPARE_PART', 'RAW_MATERIAL', 'CONSUMABLE', 'TOOL', 'SAFETY', 'GENERAL'];
const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'RECEIVED'];
const URG_COLORS: Record<string, string> = {
  ROUTINE: 'bg-gray-200 text-gray-700', SOON: 'bg-blue-100 text-blue-700',
  URGENT: 'bg-orange-100 text-orange-700', EMERGENCY: 'bg-red-100 text-red-700',
};
const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-600', SUBMITTED: 'bg-blue-100 text-blue-700',
  APPROVED: 'bg-green-100 text-green-700', REJECTED: 'bg-red-100 text-red-700',
  ORDERED: 'bg-purple-100 text-purple-700', RECEIVED: 'bg-emerald-100 text-emerald-700',
};

interface PR {
  id: string; reqNo: number; title: string; itemName: string;
  quantity: number; unit: string; estimatedCost: number;
  urgency: string; category: string; justification: string | null;
  supplier: string | null; status: string; approvedBy: string | null;
  approvedAt: string | null; rejectionReason: string | null;
  requestedBy: string; remarks: string | null; createdAt: string;
}

export default function PurchaseRequisition() {
  const [reqs, setReqs] = useState<PR[]>([]);
  const [stats, setStats] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'list' | 'new'>('list');
  const [filterStatus, setFilterStatus] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '', itemName: '', quantity: '1', unit: 'nos', estimatedCost: '',
    urgency: 'ROUTINE', category: 'GENERAL', justification: '', supplier: '', remarks: '',
  });
  const [saving, setSaving] = useState(false);

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
      await api.post('/purchase-requisition', { ...form, status: 'SUBMITTED' });
      setForm({ title: '', itemName: '', quantity: '1', unit: 'nos', estimatedCost: '', urgency: 'ROUTINE', category: 'GENERAL', justification: '', supplier: '', remarks: '' });
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

  if (loading) return <div className="p-6 text-center text-gray-400">Loading requisitions...</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold flex items-center gap-2"><ShoppingCart size={22} /> Purchase Requisitions</h1>
        <button onClick={() => setTab('new')} className="btn-primary text-sm flex items-center gap-1"><Plus size={16} /> New Request</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-3">
        {STATUSES.map(s => (
          <div key={s} className={`card p-3 text-center cursor-pointer ${filterStatus === s ? 'ring-2 ring-blue-400' : ''}`}
            onClick={() => setFilterStatus(filterStatus === s ? '' : s)}>
            <div className="text-xs text-gray-500">{s}</div>
            <div className="text-lg font-bold">{stats.byStatus?.[s] || 0}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <div className="card p-3 text-center">
          <div className="text-xs text-gray-500">Total Requests</div>
          <div className="text-lg font-bold">{stats.total || 0}</div>
        </div>
        <div className="card p-3 text-center">
          <div className="text-xs text-gray-500">Pending Value</div>
          <div className="text-lg font-bold text-orange-600">₹{((stats.pendingValue || 0) / 1000).toFixed(1)}K</div>
        </div>
        <div className="card p-3 text-center">
          <div className="text-xs text-gray-500">Total Value</div>
          <div className="text-lg font-bold">₹{((stats.totalValue || 0) / 1000).toFixed(1)}K</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b">
        <button onClick={() => setTab('list')} className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === 'list' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'}`}>
          All Requests ({reqs.length})
        </button>
        <button onClick={() => setTab('new')} className={`px-3 py-2 text-sm font-medium border-b-2 ${tab === 'new' ? 'border-blue-500 text-blue-600' : 'border-transparent text-gray-500'}`}>
          + New Request
        </button>
      </div>

      {/* New Request Form */}
      {tab === 'new' && (
        <form onSubmit={handleCreate} className="card p-4 space-y-3">
          <h3 className="font-semibold">New Purchase Request</h3>
          <input className="input-field w-full" placeholder="Request Title (e.g., Need new pump seal) *" required
            value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <input className="input-field" placeholder="Item Name *" required value={form.itemName}
              onChange={e => setForm({ ...form, itemName: e.target.value })} />
            <div className="flex gap-2">
              <input className="input-field flex-1" type="number" step="any" placeholder="Qty" value={form.quantity}
                onChange={e => setForm({ ...form, quantity: e.target.value })} />
              <select className="input-field w-20" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })}>
                {['nos', 'kg', 'ltr', 'mtr', 'set', 'pair', 'roll'].map(u => <option key={u} value={u}>{u}</option>)}
              </select>
            </div>
            <input className="input-field" type="number" step="any" placeholder="Estimated Cost (₹)" value={form.estimatedCost}
              onChange={e => setForm({ ...form, estimatedCost: e.target.value })} />
            <select className="input-field" value={form.urgency} onChange={e => setForm({ ...form, urgency: e.target.value })}>
              {URGENCIES.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <select className="input-field" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
            </select>
            <input className="input-field" placeholder="Preferred Supplier" value={form.supplier}
              onChange={e => setForm({ ...form, supplier: e.target.value })} />
          </div>
          <textarea className="input-field w-full" rows={2} placeholder="Justification — why is this needed?"
            value={form.justification} onChange={e => setForm({ ...form, justification: e.target.value })} />
          <textarea className="input-field w-full" rows={2} placeholder="Additional Remarks"
            value={form.remarks} onChange={e => setForm({ ...form, remarks: e.target.value })} />
          <button type="submit" disabled={saving} className="btn-primary w-full md:w-auto">{saving ? 'Submitting...' : 'Submit Request'}</button>
        </form>
      )}

      {/* Requisition List */}
      {tab === 'list' && (
        <div className="space-y-2">
          {reqs.length === 0 && <div className="card p-6 text-center text-gray-400">No requisitions found</div>}
          {reqs.map(pr => {
            const isExpanded = expanded === pr.id;
            const totalCost = pr.quantity * pr.estimatedCost;
            return (
              <div key={pr.id} className="card overflow-hidden">
                <div className="p-3 flex items-start gap-3 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : pr.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium">#{pr.reqNo} {pr.title}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${URG_COLORS[pr.urgency]}`}>{pr.urgency}</span>
                      <span className={`px-2 py-0.5 rounded-full text-xs ${STATUS_COLORS[pr.status]}`}>{pr.status}</span>
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {pr.itemName} · {pr.quantity} {pr.unit} · ₹{totalCost.toLocaleString()}
                      {pr.supplier && <span> · {pr.supplier}</span>}
                      <span> · {pr.requestedBy} · {new Date(pr.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                </div>

                {isExpanded && (
                  <div className="border-t p-3 space-y-3 bg-gray-50">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm">
                      <div><span className="text-gray-500 text-xs">Item:</span> <strong>{pr.itemName}</strong></div>
                      <div><span className="text-gray-500 text-xs">Qty:</span> <strong>{pr.quantity} {pr.unit}</strong></div>
                      <div><span className="text-gray-500 text-xs">Cost/Unit:</span> <strong>₹{pr.estimatedCost}</strong></div>
                      <div><span className="text-gray-500 text-xs">Total:</span> <strong>₹{totalCost.toLocaleString()}</strong></div>
                    </div>

                    {pr.justification && <p className="text-sm text-gray-700"><strong>Justification:</strong> {pr.justification}</p>}
                    {pr.remarks && <p className="text-sm text-gray-500"><strong>Remarks:</strong> {pr.remarks}</p>}
                    {pr.approvedBy && <p className="text-sm text-green-700"><Check size={14} className="inline" /> Approved by {pr.approvedBy} on {new Date(pr.approvedAt!).toLocaleDateString()}</p>}
                    {pr.rejectionReason && <p className="text-sm text-red-700"><X size={14} className="inline" /> Rejected: {pr.rejectionReason}</p>}

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2">
                      {pr.status === 'SUBMITTED' && (
                        <>
                          <button onClick={() => updateStatus(pr.id, 'APPROVED')} className="btn-primary text-xs flex items-center gap-1"><Check size={14} /> Approve</button>
                          <button onClick={() => {
                            const reason = prompt('Rejection reason:');
                            if (reason) updateStatus(pr.id, 'REJECTED', { rejectionReason: reason });
                          }} className="btn-secondary text-xs text-red-600">Reject</button>
                        </>
                      )}
                      {pr.status === 'APPROVED' && (
                        <button onClick={() => updateStatus(pr.id, 'ORDERED')} className="btn-secondary text-xs">Mark Ordered</button>
                      )}
                      {pr.status === 'ORDERED' && (
                        <button onClick={() => updateStatus(pr.id, 'RECEIVED')} className="btn-primary text-xs">Mark Received</button>
                      )}
                      {pr.status === 'REJECTED' && (
                        <button onClick={() => updateStatus(pr.id, 'DRAFT')} className="btn-secondary text-xs">Resubmit</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
