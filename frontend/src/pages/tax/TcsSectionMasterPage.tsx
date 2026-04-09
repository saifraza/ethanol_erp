import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface TcsSection {
  id: string;
  code: string;
  nature: string;
  rate: number;
  threshold: number;
  effectiveFrom: string;
  effectiveTill: string | null;
  isActive: boolean;
}

function fmtDate(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtInr(n: number): string {
  if (!n && n !== 0) return '--';
  return '₹' + n.toLocaleString('en-IN');
}

interface FormState {
  code: string;
  nature: string;
  rate: number;
  threshold: number;
  effectiveFrom: string;
  isActive: boolean;
}

const EMPTY: FormState = { code: '', nature: '', rate: 0.1, threshold: 5000000, effectiveFrom: '', isActive: true };

export default function TcsSectionMasterPage() {
  const [data, setData] = useState<TcsSection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<TcsSection | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [busy, setBusy] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get<TcsSection[]>('/tax/tcs-sections');
      setData(res.data || []);
    } catch (err: unknown) {
      console.error('Failed to fetch TCS sections:', err);
      setError('Failed to load TCS sections');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const openNew = () => { setEditing(null); setForm(EMPTY); setShowForm(true); };
  const openEdit = (s: TcsSection) => {
    setEditing(s);
    setForm({
      code: s.code, nature: s.nature, rate: s.rate, threshold: s.threshold,
      effectiveFrom: s.effectiveFrom.slice(0, 10), isActive: s.isActive,
    });
    setShowForm(true);
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        code: form.code, nature: form.nature, rate: form.rate, threshold: form.threshold,
        effectiveFrom: form.effectiveFrom ? new Date(form.effectiveFrom).toISOString() : new Date().toISOString(),
        isActive: form.isActive,
      };
      if (editing) await api.put(`/tax/tcs-sections/${editing.id}`, payload);
      else await api.post('/tax/tcs-sections', payload);
      setShowForm(false);
      fetchData();
    } catch (err: unknown) {
      console.error('Save failed:', err);
      setError('Failed to save TCS section');
    } finally {
      setBusy(false);
    }
  };

  const inputCls = 'border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 bg-white w-full';
  const labelCls = 'text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block';

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">TCS Sections</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Tax Collected at Source master</span>
          </div>
          <button onClick={openNew}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + New TCS Section
          </button>
        </div>

        {error && (
          <div className="bg-red-50 border-x border-b border-red-300 px-4 py-2 -mx-3 md:-mx-6">
            <span className="text-[11px] font-bold text-red-700 uppercase tracking-widest">{error}</span>
          </div>
        )}

        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Code</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Nature</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Rate (%)</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Threshold (₹)</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Effective From</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Active</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">Loading...</td></tr>
              ) : data.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No TCS sections configured</td></tr>
              ) : data.map((s, i) => (
                <tr key={s.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 font-mono font-bold text-slate-800 border-r border-slate-100">{s.code}</td>
                  <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{s.nature}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{s.rate}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{fmtInr(s.threshold)}</td>
                  <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{fmtDate(s.effectiveFrom)}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">
                    {s.isActive ? (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-600 bg-green-50 text-green-700">Yes</span>
                    ) : (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-400 bg-slate-50 text-slate-500">No</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button onClick={() => openEdit(s)}
                      className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50">
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowForm(false)}>
          <div className="bg-white shadow-2xl w-full max-w-xl" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <span className="text-xs font-bold uppercase tracking-widest">{editing ? 'Edit TCS Section' : 'New TCS Section'}</span>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Code</label>
                <input className={inputCls + ' font-mono'} value={form.code}
                  onChange={e => setForm({ ...form, code: e.target.value })} placeholder="206C_1H" />
              </div>
              <div>
                <label className={labelCls}>Effective From</label>
                <input type="date" className={inputCls} value={form.effectiveFrom}
                  onChange={e => setForm({ ...form, effectiveFrom: e.target.value })} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Nature</label>
                <input className={inputCls} value={form.nature}
                  onChange={e => setForm({ ...form, nature: e.target.value })} placeholder="Sale of goods above ₹50L" />
              </div>
              <div>
                <label className={labelCls}>Rate (%)</label>
                <input type="number" step="0.01" className={inputCls + ' font-mono tabular-nums'} value={form.rate}
                  onChange={e => setForm({ ...form, rate: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className={labelCls}>Threshold (₹)</label>
                <input type="number" className={inputCls + ' font-mono tabular-nums'} value={form.threshold}
                  onChange={e => setForm({ ...form, threshold: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Active</label>
                <div className="flex items-center h-[30px]">
                  <input type="checkbox" checked={form.isActive}
                    onChange={e => setForm({ ...form, isActive: e.target.checked })} className="mr-2" />
                  <span className="text-xs text-slate-700">{form.isActive ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
            </div>
            <div className="bg-slate-100 border-t border-slate-300 px-4 py-2 flex items-center justify-end gap-2">
              <button onClick={() => setShowForm(false)}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleSave} disabled={busy}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
