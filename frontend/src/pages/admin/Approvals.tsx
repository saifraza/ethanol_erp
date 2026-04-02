import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface ApprovalItem {
  id: string;
  type: string;
  status: string;
  entityType: string;
  entityId: string;
  title: string;
  description: string;
  requestedBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  reviewNote: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export default function Approvals() {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | 'ALL'>('PENDING');
  const [actionId, setActionId] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState('');
  const [saving, setSaving] = useState(false);

  const fetchApprovals = useCallback(async () => {
    try {
      setLoading(true);
      const params = tab === 'ALL' ? {} : { status: tab };
      const res = await api.get('/approvals', { params });
      setApprovals(res.data);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, [tab]);

  useEffect(() => { fetchApprovals(); }, [fetchApprovals]);

  const handleAction = async (id: string, status: 'APPROVED' | 'REJECTED') => {
    setSaving(true);
    try {
      await api.put(`/approvals/${id}`, { status, reviewNote });
      setActionId(null);
      setReviewNote('');
      fetchApprovals();
    } catch (err: unknown) {
      alert((err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  };

  const fmtDate = (s: string) => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });

  const typeColors: Record<string, string> = {
    PO_OVERAGE: 'border-orange-300 bg-orange-50 text-orange-700',
    RATE_CHANGE: 'border-blue-300 bg-blue-50 text-blue-700',
    CREDIT_LIMIT: 'border-purple-300 bg-purple-50 text-purple-700',
  };

  const statusColors: Record<string, string> = {
    PENDING: 'border-yellow-300 bg-yellow-50 text-yellow-700',
    APPROVED: 'border-green-300 bg-green-50 text-green-700',
    REJECTED: 'border-red-300 bg-red-50 text-red-700',
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Approvals</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Admin review queue</span>
          </div>
        </div>

        {/* Tabs */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-100 px-4 py-2 flex gap-4">
          {(['PENDING', 'APPROVED', 'REJECTED', 'ALL'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`text-[11px] font-bold uppercase tracking-widest pb-1 ${tab === t ? 'text-slate-800 border-b-2 border-blue-600' : 'text-slate-400 hover:text-slate-600'}`}>
              {t} {t === 'PENDING' && approvals.length > 0 && tab === 'PENDING' ? `(${approvals.length})` : ''}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          {loading ? (
            <div className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Type</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Title</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Description</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                  <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Date</th>
                  <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                </tr>
              </thead>
              <tbody>
                {approvals.map((a, i) => (
                  <tr key={a.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-2 border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${typeColors[a.type] || 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                        {a.type.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-semibold text-slate-800 border-r border-slate-100">{a.title}</td>
                    <td className="px-3 py-2 text-slate-600 border-r border-slate-100 max-w-md">
                      <div className="truncate">{a.description}</div>
                      {a.reviewNote && <div className="text-[10px] text-slate-400 mt-0.5">Note: {a.reviewNote}</div>}
                    </td>
                    <td className="px-3 py-2 border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${statusColors[a.status] || ''}`}>
                        {a.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-slate-500 font-mono border-r border-slate-100">{fmtDate(a.createdAt)}</td>
                    <td className="px-3 py-2 text-center">
                      {a.status === 'PENDING' ? (
                        actionId === a.id ? (
                          <div className="flex items-center gap-1">
                            <input value={reviewNote} onChange={e => setReviewNote(e.target.value)} placeholder="Note (optional)"
                              className="border border-slate-300 px-1.5 py-0.5 text-[10px] w-28 focus:outline-none" />
                            <button onClick={() => handleAction(a.id, 'APPROVED')} disabled={saving}
                              className="px-2 py-0.5 bg-green-600 text-white text-[10px] font-bold uppercase hover:bg-green-700 disabled:opacity-50">OK</button>
                            <button onClick={() => handleAction(a.id, 'REJECTED')} disabled={saving}
                              className="px-2 py-0.5 bg-red-600 text-white text-[10px] font-bold uppercase hover:bg-red-700 disabled:opacity-50">No</button>
                            <button onClick={() => { setActionId(null); setReviewNote(''); }}
                              className="px-1 py-0.5 text-slate-400 text-[10px] hover:text-slate-600">X</button>
                          </div>
                        ) : (
                          <button onClick={() => setActionId(a.id)}
                            className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-bold uppercase hover:bg-blue-700">Review</button>
                        )
                      ) : (
                        <span className="text-[10px] text-slate-400">{a.reviewedBy ? `by ${a.reviewedBy.slice(0, 8)}` : '--'}</span>
                      )}
                    </td>
                  </tr>
                ))}
                {approvals.length === 0 && (
                  <tr><td colSpan={6} className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest">
                    {tab === 'PENDING' ? 'No pending approvals' : 'No approvals found'}
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
