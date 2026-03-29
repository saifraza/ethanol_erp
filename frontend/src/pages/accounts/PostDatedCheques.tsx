import React, { useState, useEffect, useCallback } from 'react';
import { FileText, X } from 'lucide-react';
import api from '../../services/api';

interface PDC {
  id: string;
  chequeNo: number;
  direction: 'OUTGOING' | 'INCOMING';
  chequeNumber: string;
  chequeDate: string;
  maturityDate: string;
  amount: number;
  bankName: string;
  branchName: string | null;
  partyType: string;
  partyId: string;
  partyName: string;
  purpose: string | null;
  status: 'ISSUED' | 'DEPOSITED' | 'CLEARED' | 'DISHONOURED' | 'CANCELLED';
  depositDate: string | null;
  clearDate: string | null;
  dishonourDate: string | null;
  dishonourReason: string | null;
  remarks: string | null;
}

interface Summary {
  active: { amount: number; count: number };
  maturingThisWeek: { amount: number; count: number };
  overdue: { amount: number; count: number };
  clearedThisMonth: { amount: number; count: number };
}

interface Party { id: string; name: string; }

const fmt = (n: number) => n === 0 ? '--' : '\u20B9' + Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
const fmtDate = (d: string | null) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : '--';
const todayStr = () => new Date().toISOString().split('T')[0];

const STATUS_COLORS: Record<string, string> = {
  ISSUED: 'border-blue-300 bg-blue-50 text-blue-700',
  DEPOSITED: 'border-amber-300 bg-amber-50 text-amber-700',
  CLEARED: 'border-green-300 bg-green-50 text-green-700',
  DISHONOURED: 'border-red-300 bg-red-50 text-red-700',
  CANCELLED: 'border-slate-300 bg-slate-100 text-slate-500',
};

export default function PostDatedCheques() {
  const [items, setItems] = useState<PDC[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  // Filters
  const [direction, setDirection] = useState<'OUTGOING' | 'INCOMING'>('OUTGOING');
  const [filterStatus, setFilterStatus] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  // Parties
  const [vendors, setVendors] = useState<Party[]>([]);
  const [customers, setCustomers] = useState<Party[]>([]);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    direction: 'OUTGOING' as string,
    chequeNumber: '', chequeDate: todayStr(), maturityDate: '',
    amount: '', bankName: '', branchName: '',
    partyType: 'VENDOR' as string, partyId: '', partyName: '',
    purpose: '', remarks: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  // Dishonour modal
  const [dishonourItem, setDishonourItem] = useState<PDC | null>(null);
  const [dishonourReason, setDishonourReason] = useState('');

  // ═══════════════════════════════════════════════
  // Fetchers
  // ═══════════════════════════════════════════════

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params: Record<string, string> = { direction };
      if (filterStatus) params.status = filterStatus;
      if (dateFrom) params.from = dateFrom;
      if (dateTo) params.to = dateTo;

      const [listRes, summaryRes] = await Promise.all([
        api.get<{ items: PDC[] }>('/post-dated-cheques', { params }),
        api.get<Summary>('/post-dated-cheques/summary', { params: { direction } }),
      ]);
      setItems(listRes.data.items || []);
      setSummary(summaryRes.data);
    } catch (err) {
      console.error('Failed to fetch PDCs:', err);
    } finally {
      setLoading(false);
    }
  }, [direction, filterStatus, dateFrom, dateTo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    api.get('/vendors', { params: { limit: 200 } }).then(r => {
      setVendors((r.data.vendors || []).map((v: any) => ({ id: v.id, name: v.name })));
    }).catch(() => {});
    api.get('/customers', { params: { limit: 200 } }).then(r => {
      const list = Array.isArray(r.data) ? r.data : (r.data as { items?: Party[] }).items || [];
      setCustomers(list.map((c: any) => ({ id: c.id, name: c.name })));
    }).catch(() => {});
  }, []);

  // ═══════════════════════════════════════════════
  // Actions
  // ═══════════════════════════════════════════════

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      setSubmitting(true);
      setError('');
      await api.post('/post-dated-cheques', {
        ...form,
        amount: parseFloat(form.amount) || 0,
      });
      setShowCreate(false);
      setForm({ direction: 'OUTGOING', chequeNumber: '', chequeDate: todayStr(), maturityDate: '', amount: '', bankName: '', branchName: '', partyType: 'VENDOR', partyId: '', partyName: '', purpose: '', remarks: '' });
      fetchData();
    } catch (err: unknown) {
      setError((err as any)?.response?.data?.error || 'Failed to create PDC');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeposit = async (id: string) => {
    if (!confirm('Mark this cheque as deposited in bank?')) return;
    try {
      await api.put(`/post-dated-cheques/${id}/deposit`, { depositDate: todayStr() });
      fetchData();
    } catch (err: unknown) { alert((err as any)?.response?.data?.error || 'Failed'); }
  };

  const handleClear = async (id: string) => {
    if (!confirm('Mark this cheque as cleared? This will create a payment record.')) return;
    try {
      await api.put(`/post-dated-cheques/${id}/clear`, { clearDate: todayStr() });
      fetchData();
    } catch (err: unknown) { alert((err as any)?.response?.data?.error || 'Failed'); }
  };

  const handleDishonour = async () => {
    if (!dishonourItem) return;
    try {
      await api.put(`/post-dated-cheques/${dishonourItem.id}/dishonour`, { reason: dishonourReason });
      setDishonourItem(null);
      setDishonourReason('');
      fetchData();
    } catch (err: unknown) { alert((err as any)?.response?.data?.error || 'Failed'); }
  };

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this cheque?')) return;
    try {
      await api.delete(`/post-dated-cheques/${id}`);
      fetchData();
    } catch (err: unknown) { alert((err as any)?.response?.data?.error || 'Failed'); }
  };

  // Days until maturity
  const daysLeft = (d: string) => {
    const diff = new Date(d).getTime() - new Date().getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  };

  const daysColor = (days: number) => {
    if (days < 0) return 'text-red-600 font-bold';
    if (days <= 7) return 'text-amber-600 font-bold';
    return 'text-green-600';
  };

  const partyList = form.partyType === 'VENDOR' ? vendors : customers;

  // ═══════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileText size={18} />
            <h1 className="text-sm font-bold tracking-wide uppercase">PDC Register</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Post-Dated Cheques</span>
          </div>
          <button onClick={() => { setForm(f => ({ ...f, direction })); setShowCreate(true); setError(''); }}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + NEW PDC
          </button>
        </div>

        {/* Direction Toggle + Filters */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-4 flex-wrap">
          <div className="flex gap-1">
            {(['OUTGOING', 'INCOMING'] as const).map(d => (
              <button key={d} onClick={() => setDirection(d)}
                className={`px-3 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${direction === d ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                {d === 'OUTGOING' ? 'We Give' : 'We Receive'}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {['', 'ISSUED', 'DEPOSITED', 'CLEARED', 'DISHONOURED'].map(s => (
              <button key={s} onClick={() => setFilterStatus(s)}
                className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border ${filterStatus === s ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'}`}>
                {s || 'ALL'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">From</label>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
            <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">To</label>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
            {(dateFrom || dateTo) && <button onClick={() => { setDateFrom(''); setDateTo(''); }} className="text-[10px] text-red-500">Clear</button>}
          </div>
        </div>

        {/* KPI Strip */}
        {summary && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active</div>
              <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{fmt(summary.active.amount)}</div>
              <div className="text-[10px] text-slate-400">{summary.active.count} cheques</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Maturing This Week</div>
              <div className="text-xl font-bold text-amber-600 mt-1 font-mono tabular-nums">{fmt(summary.maturingThisWeek.amount)}</div>
              <div className="text-[10px] text-slate-400">{summary.maturingThisWeek.count} cheques</div>
            </div>
            <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Overdue</div>
              <div className="text-xl font-bold text-red-600 mt-1 font-mono tabular-nums">{fmt(summary.overdue.amount)}</div>
              <div className="text-[10px] text-slate-400">{summary.overdue.count} cheques</div>
            </div>
            <div className="bg-white px-4 py-3 border-l-4 border-l-green-500">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cleared This Month</div>
              <div className="text-xl font-bold text-green-600 mt-1 font-mono tabular-nums">{fmt(summary.clearedThisMonth.amount)}</div>
              <div className="text-[10px] text-slate-400">{summary.clearedThisMonth.count} cheques</div>
            </div>
          </div>
        )}

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          {loading ? (
            <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">Loading...</div>
          ) : items.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-400 uppercase tracking-widest bg-white">No post-dated cheques found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PDC#</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Party</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Cheque#</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Amount</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Bank</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Cheque Date</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Maturity</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Days</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                    <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item, i) => {
                    const days = daysLeft(item.maturityDate);
                    return (
                      <tr key={item.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-blue-700">PDC-{item.chequeNo}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 font-medium text-slate-800 max-w-[160px] truncate">{item.partyName}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{item.chequeNumber}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums font-bold">{fmt(item.amount)}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600">{item.bankName}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(item.chequeDate)}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 whitespace-nowrap">{fmtDate(item.maturityDate)}</td>
                        <td className={`px-3 py-1.5 border-r border-slate-100 text-right font-mono tabular-nums ${['CLEARED', 'DISHONOURED', 'CANCELLED'].includes(item.status) ? 'text-slate-400' : daysColor(days)}`}>
                          {['CLEARED', 'DISHONOURED', 'CANCELLED'].includes(item.status) ? '--' : days > 0 ? days : days}
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_COLORS[item.status] || STATUS_COLORS.ISSUED}`}>{item.status}</span>
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          <div className="flex items-center justify-center gap-1">
                            {item.status === 'ISSUED' && (
                              <>
                                <button onClick={() => handleDeposit(item.id)} className="px-2 py-0.5 bg-amber-600 text-white text-[9px] font-bold uppercase hover:bg-amber-700">Deposit</button>
                                <button onClick={() => handleCancel(item.id)} className="px-2 py-0.5 bg-slate-400 text-white text-[9px] font-bold uppercase hover:bg-slate-500">Cancel</button>
                              </>
                            )}
                            {item.status === 'DEPOSITED' && (
                              <>
                                <button onClick={() => handleClear(item.id)} className="px-2 py-0.5 bg-green-600 text-white text-[9px] font-bold uppercase hover:bg-green-700">Clear</button>
                                <button onClick={() => { setDishonourItem(item); setDishonourReason(''); }} className="px-2 py-0.5 bg-red-600 text-white text-[9px] font-bold uppercase hover:bg-red-700">Dishonour</button>
                              </>
                            )}
                            {item.status === 'DISHONOURED' && item.dishonourReason && (
                              <span className="text-[9px] text-red-500" title={item.dishonourReason}>{item.dishonourReason}</span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-800 text-white font-semibold">
                    <td className="px-3 py-2 text-[10px] uppercase tracking-widest" colSpan={3}>Total ({items.length} cheques)</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmt(items.reduce((s, i) => s + i.amount, 0))}</td>
                    <td colSpan={6}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>

        {/* ═══════════════════════════════════════ */}
        {/* CREATE MODAL */}
        {/* ═══════════════════════════════════════ */}
        {showCreate && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-2xl mx-4">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest">New Post-Dated Cheque</span>
                <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-white"><X size={16} /></button>
              </div>
              <form onSubmit={handleCreate} className="p-4 space-y-3">
                {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-1.5">{error}</div>}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Direction *</label>
                    <select value={form.direction} onChange={e => setForm(f => ({ ...f, direction: e.target.value, partyType: e.target.value === 'OUTGOING' ? 'VENDOR' : 'CUSTOMER', partyId: '', partyName: '' }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="OUTGOING">Outgoing (We Give)</option>
                      <option value="INCOMING">Incoming (We Receive)</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">{form.direction === 'OUTGOING' ? 'Vendor' : 'Customer'} *</label>
                    <select value={form.partyId} onChange={e => {
                      const party = partyList.find(p => p.id === e.target.value);
                      setForm(f => ({ ...f, partyId: e.target.value, partyName: party?.name || '' }));
                    }} required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                      <option value="">Select {form.direction === 'OUTGOING' ? 'Vendor' : 'Customer'}</option>
                      {partyList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Cheque Number *</label>
                    <input type="text" value={form.chequeNumber} onChange={e => setForm(f => ({ ...f, chequeNumber: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Cheque Date *</label>
                    <input type="date" value={form.chequeDate} onChange={e => setForm(f => ({ ...f, chequeDate: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Maturity Date *</label>
                    <input type="date" value={form.maturityDate} onChange={e => setForm(f => ({ ...f, maturityDate: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Amount *</label>
                    <input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Bank Name *</label>
                    <input type="text" value={form.bankName} onChange={e => setForm(f => ({ ...f, bankName: e.target.value }))}
                      required className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Branch</label>
                    <input type="text" value={form.branchName} onChange={e => setForm(f => ({ ...f, branchName: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                  </div>
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Purpose / Remarks</label>
                  <input type="text" value={form.purpose} onChange={e => setForm(f => ({ ...f, purpose: e.target.value }))}
                    placeholder="e.g. Against INV-123" className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400" />
                </div>
                <div className="flex gap-2 pt-3 border-t border-slate-200">
                  <button type="submit" disabled={submitting}
                    className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                    {submitting ? 'CREATING...' : 'CREATE PDC'}
                  </button>
                  <button type="button" onClick={() => setShowCreate(false)}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">CANCEL</button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ═══════════════════════════════════════ */}
        {/* DISHONOUR MODAL */}
        {/* ═══════════════════════════════════════ */}
        {dishonourItem && (
          <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 overflow-y-auto py-4">
            <div className="bg-white shadow-2xl w-full max-w-md mx-4">
              <div className="bg-red-700 text-white px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-widest">Dishonour Cheque</span>
                <button onClick={() => setDishonourItem(null)} className="text-red-300 hover:text-white"><X size={16} /></button>
              </div>
              <div className="p-4 space-y-3">
                <div className="text-xs text-slate-600">
                  PDC-{dishonourItem.chequeNo} | {dishonourItem.partyName} | {fmt(dishonourItem.amount)}
                </div>
                <div>
                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Reason for Dishonour *</label>
                  <select value={dishonourReason} onChange={e => setDishonourReason(e.target.value)}
                    className="border border-slate-300 px-2.5 py-1.5 text-xs w-full focus:outline-none focus:ring-1 focus:ring-slate-400">
                    <option value="">Select reason</option>
                    <option value="Insufficient funds">Insufficient funds</option>
                    <option value="Account closed">Account closed</option>
                    <option value="Signature mismatch">Signature mismatch</option>
                    <option value="Cheque expired">Cheque expired (stale)</option>
                    <option value="Payment stopped">Payment stopped by drawer</option>
                    <option value="Amount mismatch">Amount in words/figures differs</option>
                    <option value="Other">Other</option>
                  </select>
                </div>
                <div className="flex gap-2 pt-3 border-t border-slate-200">
                  <button onClick={handleDishonour} disabled={!dishonourReason}
                    className="px-4 py-1.5 bg-red-600 text-white text-[11px] font-medium hover:bg-red-700 disabled:opacity-50">DISHONOUR</button>
                  <button onClick={() => setDishonourItem(null)}
                    className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">CANCEL</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
