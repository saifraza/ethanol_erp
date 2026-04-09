import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface FiscalYear {
  id: string;
  code: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  isClosed: boolean;
  closedAt: string | null;
  closedBy: string | null;
}

function fmtDate(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: true });
}

function toDateInput(d: string | null): string {
  if (!d) return '';
  const dt = new Date(d);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

export default function FiscalYearsPage() {
  const [data, setData] = useState<FiscalYear[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ code: '', startDate: '', endDate: '' });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get<FiscalYear[]>('/tax/fiscal-years');
      setData(res.data || []);
    } catch (err: unknown) {
      console.error('Failed to fetch fiscal years:', err);
      setError('Failed to load fiscal years');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleCreate = async () => {
    if (!form.code || !form.startDate || !form.endDate) {
      setError('All fields required');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/tax/fiscal-years', {
        code: form.code,
        startDate: new Date(form.startDate).toISOString(),
        endDate: new Date(form.endDate).toISOString(),
      });
      setShowNew(false);
      setForm({ code: '', startDate: '', endDate: '' });
      fetchData();
    } catch (err: unknown) {
      console.error('Create failed:', err);
      setError('Failed to create fiscal year');
    } finally {
      setBusy(false);
    }
  };

  const handleSetCurrent = async (id: string) => {
    setBusy(true);
    try {
      await api.post(`/tax/fiscal-years/${id}/set-current`);
      fetchData();
    } catch (err: unknown) {
      console.error('Set current failed:', err);
      setError('Failed to set current fiscal year');
    } finally {
      setBusy(false);
    }
  };

  const handleClose = async (fy: FiscalYear) => {
    if (!window.confirm(`Close ${fy.code}? This locks all backdated entries for this FY.`)) return;
    setBusy(true);
    try {
      await api.post(`/tax/fiscal-years/${fy.id}/close`);
      fetchData();
    } catch (err: unknown) {
      console.error('Close failed:', err);
      setError('Failed to close fiscal year');
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white w-full';
  const labelCls = 'text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block';

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Fiscal Years</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Period control & closing</span>
          </div>
          <button onClick={() => setShowNew(true)}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + New FY
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border-x border-b border-red-300 px-4 py-2 -mx-3 md:-mx-6">
            <span className="text-[11px] font-bold text-red-700 uppercase tracking-widest">{error}</span>
          </div>
        )}

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Start</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">End</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Current</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Closed At</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Closed By</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {data.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No fiscal years configured</td>
                </tr>
              ) : data.map((fy, i) => (
                <tr key={fy.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 font-mono font-bold text-slate-800 border-r border-slate-100">{fy.code}</td>
                  <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{fmtDate(fy.startDate)}</td>
                  <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{fmtDate(fy.endDate)}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">
                    {fy.isCurrent ? (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-600 bg-green-50 text-green-700">Current</span>
                    ) : (
                      <span className="text-[9px] text-slate-400">--</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 border-r border-slate-100">
                    {fy.isClosed ? (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-red-600 bg-red-50 text-red-700">Closed</span>
                    ) : (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-blue-600 bg-blue-50 text-blue-700">Open</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100 font-mono tabular-nums">{fmtDateTime(fy.closedAt)}</td>
                  <td className="px-3 py-1.5 text-slate-500 border-r border-slate-100">{fy.closedBy || '--'}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {!fy.isCurrent && !fy.isClosed && (
                        <button disabled={busy} onClick={() => handleSetCurrent(fy.id)}
                          className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50 disabled:opacity-50">
                          Set Current
                        </button>
                      )}
                      {!fy.isClosed && (
                        <button disabled={busy} onClick={() => handleClose(fy)}
                          className="px-2 py-0.5 bg-white border border-red-300 text-red-600 text-[10px] font-medium hover:bg-red-50 disabled:opacity-50">
                          Close
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: New FY */}
      {showNew && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNew(false)}>
          <div className="bg-white shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <span className="text-xs font-bold uppercase tracking-widest">New Fiscal Year</span>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className={labelCls}>Code (e.g. 2027-28)</label>
                <input className={inputCls + ' font-mono'} value={form.code}
                  onChange={e => setForm({ ...form, code: e.target.value })} placeholder="2027-28" />
              </div>
              <div>
                <label className={labelCls}>Start Date</label>
                <input type="date" className={inputCls} value={form.startDate}
                  onChange={e => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>End Date</label>
                <input type="date" className={inputCls} value={form.endDate}
                  onChange={e => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            <div className="bg-slate-100 border-t border-slate-300 px-4 py-2 flex items-center justify-end gap-2">
              <button onClick={() => setShowNew(false)}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleCreate} disabled={busy}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
