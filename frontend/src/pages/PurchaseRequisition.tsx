import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import api from '../services/api';
import { Plus, Check, X, ChevronDown, ChevronUp, Search } from 'lucide-react';

const URGENCIES = ['ROUTINE', 'SOON', 'URGENT', 'EMERGENCY'];
const CATEGORIES = ['SPARE_PART', 'RAW_MATERIAL', 'CONSUMABLE', 'TOOL', 'SAFETY', 'CHEMICAL', 'MECHANICAL', 'ELECTRICAL', 'GENERAL'];
const STATUSES = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'ORDERED', 'RECEIVED'];

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
  ORDERED: 'border-purple-500 bg-purple-50 text-purple-700',
  RECEIVED: 'border-emerald-600 bg-emerald-50 text-emerald-700',
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
  const [searchParams] = useSearchParams();
  const [reqs, setReqs] = useState<PR[]>([]);
  const [stats, setStats] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'list' | 'new'>(searchParams.get('new') ? 'new' : 'list');
  const [filterStatus, setFilterStatus] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: '', itemName: '', quantity: '1', unit: 'nos', estimatedCost: '',
    urgency: 'ROUTINE', category: 'GENERAL', justification: '', supplier: '', remarks: '',
    department: '', inventoryItemId: '', requestedByPerson: '',
  });
  const [saving, setSaving] = useState(false);

  // Inventory item search for linking
  const [invItems, setInvItems] = useState<InvItem[]>([]);
  const [itemQuery, setItemQuery] = useState('');
  const [showItemDropdown, setShowItemDropdown] = useState(false);
  const [departments, setDepartments] = useState<string[]>([]);

  useEffect(() => {
    api.get('/inventory/items').then(r => setInvItems(r.data.items || [])).catch(() => {});
    api.get('/departments').then(r => setDepartments((r.data || []).filter((d: { isActive: boolean }) => d.isActive).map((d: { name: string }) => d.name))).catch(() => {});
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
      await api.post('/purchase-requisition', { ...form, status: 'SUBMITTED' });
      setForm({ title: '', itemName: '', quantity: '1', unit: 'nos', estimatedCost: '', urgency: 'ROUTINE', category: 'GENERAL', justification: '', supplier: '', remarks: '', department: '', inventoryItemId: '', requestedByPerson: '' });
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
        <h1 className="text-sm font-bold tracking-wide uppercase">Purchase Requisitions</h1>
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
      </div>

      {/* New Request Form */}
      {tab === 'new' && (
        <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <div className="bg-slate-100 border-b border-slate-300 px-4 py-2">
            <h3 className="text-[11px] font-bold uppercase tracking-widest text-slate-700">New Purchase Request</h3>
          </div>
          <form onSubmit={handleCreate} className="p-4 space-y-3">
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Request Title *</label>
              <input
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                placeholder="e.g., Need new pump seal"
                required
                value={form.title}
                onChange={e => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="relative">
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Item (search inventory) *</label>
                <div className="flex gap-1">
                  <div className="relative flex-1">
                    <input
                      className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                      placeholder="Type to search items..."
                      required
                      value={itemQuery}
                      onChange={e => { setItemQuery(e.target.value); setForm({ ...form, itemName: e.target.value }); setShowItemDropdown(true); }}
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
                                estimatedCost: it.costPerUnit ? String(it.costPerUnit) : f.estimatedCost,
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
                          <div className="px-2.5 py-1.5 text-[10px] text-slate-400">No matching items — will create as new</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                {form.inventoryItemId && (() => {
                  const item = invItems.find(i => i.id === form.inventoryItemId);
                  if (!item) return <div className="text-[9px] text-green-600 mt-0.5">Linked to inventory</div>;
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
                  <input
                    className="flex-1 border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    type="number"
                    step="any"
                    placeholder="Qty"
                    value={form.quantity}
                    onChange={e => setForm({ ...form, quantity: e.target.value })}
                  />
                  <select
                    className="w-20 border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                    value={form.unit}
                    onChange={e => setForm({ ...form, unit: e.target.value })}
                  >
                    {['nos', 'kg', 'ltr', 'mtr', 'set', 'pair', 'roll'].map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Estimated Cost (Rs)</label>
                <input
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  type="number"
                  step="any"
                  placeholder="Estimated Cost"
                  value={form.estimatedCost}
                  onChange={e => setForm({ ...form, estimatedCost: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Urgency</label>
                <select
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  value={form.urgency}
                  onChange={e => setForm({ ...form, urgency: e.target.value })}
                >
                  {URGENCIES.map(u => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Category</label>
                <select
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  value={form.category}
                  onChange={e => setForm({ ...form, category: e.target.value })}
                >
                  {CATEGORIES.map(c => <option key={c} value={c}>{c.replace('_', ' ')}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Requested By (Dept)</label>
                <select
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  value={form.department}
                  onChange={e => setForm({ ...form, department: e.target.value })}
                >
                  <option value="">Select department</option>
                  {departments.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Requested By (Person)</label>
                <input
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Person name"
                  value={form.requestedByPerson || ''}
                  onChange={e => setForm({ ...form, requestedByPerson: e.target.value })}
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Preferred Supplier</label>
                <input
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                  placeholder="Preferred Supplier"
                  value={form.supplier}
                  onChange={e => setForm({ ...form, supplier: e.target.value })}
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Justification</label>
              <textarea
                className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none"
                rows={2}
                placeholder="Why is this needed?"
                value={form.justification}
                onChange={e => setForm({ ...form, justification: e.target.value })}
              />
            </div>
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
                  onClick={() => setExpanded(isExpanded ? null : pr.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-slate-800">#{pr.reqNo} {pr.title}</span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${URG_COLORS[pr.urgency]}`}>{pr.urgency}</span>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_COLORS[pr.status]}`}>{pr.status}</span>
                    </div>
                    <div className="text-[10px] text-slate-500 mt-0.5">
                      {pr.itemName} -- {pr.quantity} {pr.unit} -- <span className="font-mono tabular-nums">Rs.{totalCost.toLocaleString()}</span>
                      {pr.supplier && <span> -- {pr.supplier}</span>}
                      <span> -- {pr.requestedBy} -- {new Date(pr.createdAt).toLocaleDateString()}</span>
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

                    {/* Actions */}
                    <div className="flex flex-wrap gap-2 pt-1">
                      {pr.status === 'SUBMITTED' && (
                        <>
                          <button
                            onClick={() => updateStatus(pr.id, 'APPROVED')}
                            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 flex items-center gap-1"
                          >
                            <Check size={12} /> Approve
                          </button>
                          <button
                            onClick={() => {
                              const reason = prompt('Rejection reason:');
                              if (reason) updateStatus(pr.id, 'REJECTED', { rejectionReason: reason });
                            }}
                            className="px-3 py-1 border border-red-500 bg-red-50 text-red-700 text-[11px] font-medium hover:bg-red-100"
                          >
                            Reject
                          </button>
                        </>
                      )}
                      {pr.status === 'APPROVED' && (
                        <>
                        <a
                          href={`/procurement/purchase-orders?newPO=1&item=${encodeURIComponent(pr.itemName)}&qty=${pr.quantity}&unit=${pr.unit}&cost=${pr.estimatedCost}&supplier=${encodeURIComponent(pr.supplier || '')}&reqId=${pr.id}`}
                          className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
                        >
                          Create PO
                        </a>
                        <button
                          onClick={() => updateStatus(pr.id, 'ORDERED')}
                          className="px-3 py-1 border border-slate-400 bg-white text-slate-700 text-[11px] font-medium hover:bg-slate-100"
                        >
                          Mark Ordered
                        </button>
                        </>
                      )}
                      {pr.status === 'ORDERED' && (
                        <button
                          onClick={() => updateStatus(pr.id, 'RECEIVED')}
                          className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
                        >
                          Mark Received
                        </button>
                      )}
                      {pr.status === 'REJECTED' && (
                        <button
                          onClick={() => updateStatus(pr.id, 'DRAFT')}
                          className="px-3 py-1 border border-slate-400 bg-white text-slate-700 text-[11px] font-medium hover:bg-slate-100"
                        >
                          Resubmit
                        </button>
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
