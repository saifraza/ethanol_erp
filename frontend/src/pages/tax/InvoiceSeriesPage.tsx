import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface FiscalYear {
  id: string;
  code: string;
  isCurrent: boolean;
}

interface InvoiceSeries {
  id: string;
  fyId: string;
  docType: string;
  prefix: string;
  nextNumber: number;
  width: number;
  isActive: boolean;
}

const DOC_TYPES = [
  'TAX_INVOICE',
  'CREDIT_NOTE',
  'DEBIT_NOTE',
  'DELIVERY_CHALLAN',
  'EXPORT_INVOICE',
  'RCM_INVOICE',
];

function formatSample(series: InvoiceSeries): string {
  return series.prefix + String(series.nextNumber).padStart(series.width, '0');
}

export default function InvoiceSeriesPage() {
  const [years, setYears] = useState<FiscalYear[]>([]);
  const [fyId, setFyId] = useState<string>('');
  const [series, setSeries] = useState<InvoiceSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [editing, setEditing] = useState<InvoiceSeries | null>(null);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ docType: string; prefix: string; width: number; isActive: boolean; nextNumber: number }>({
    docType: 'TAX_INVOICE',
    prefix: '',
    width: 5,
    isActive: true,
    nextNumber: 1,
  });

  const fetchYears = useCallback(async () => {
    try {
      const res = await api.get<FiscalYear[]>('/tax/fiscal-years');
      setYears(res.data || []);
      const current = (res.data || []).find(y => y.isCurrent);
      if (current) setFyId(current.id);
      else if (res.data && res.data.length > 0) setFyId(res.data[0].id);
    } catch (err: unknown) {
      console.error('Failed to fetch fiscal years:', err);
      setError('Failed to load fiscal years');
    }
  }, []);

  const fetchSeries = useCallback(async (id: string) => {
    if (!id) return;
    try {
      setLoading(true);
      const res = await api.get<InvoiceSeries[]>(`/tax/invoice-series?fyId=${id}`);
      setSeries(res.data || []);
    } catch (err: unknown) {
      console.error('Failed to fetch invoice series:', err);
      setError('Failed to load invoice series');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchYears(); }, [fetchYears]);
  useEffect(() => { if (fyId) fetchSeries(fyId); }, [fyId, fetchSeries]);

  const openNew = () => {
    setEditing(null);
    setForm({ docType: 'TAX_INVOICE', prefix: '', width: 5, isActive: true, nextNumber: 1 });
    setShowNew(true);
  };

  const openEdit = (s: InvoiceSeries) => {
    setEditing(s);
    setForm({ docType: s.docType, prefix: s.prefix, width: s.width, isActive: s.isActive, nextNumber: s.nextNumber });
    setShowNew(true);
  };

  const handleSave = async () => {
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await api.put(`/tax/invoice-series/${editing.id}`, {
          prefix: form.prefix,
          width: form.width,
          isActive: form.isActive,
        });
      } else {
        await api.post('/tax/invoice-series', {
          fyId,
          docType: form.docType,
          prefix: form.prefix,
          width: form.width,
          isActive: form.isActive,
          nextNumber: form.nextNumber,
        });
      }
      setShowNew(false);
      fetchSeries(fyId);
    } catch (err: unknown) {
      console.error('Save failed:', err);
      setError('Failed to save invoice series');
    } finally {
      setBusy(false);
    }
  };

  const handleReserveTest = async (s: InvoiceSeries) => {
    if (!window.confirm(`This will RESERVE (burn) the next number from ${s.docType}. Continue?`)) return;
    setBusy(true);
    try {
      const res = await api.post<{ formatted: string; number: number }>(`/tax/invoice-series/${s.id}/reserve`);
      setMessage(`Reserved: ${res.data.formatted} (number ${res.data.number})`);
      setTimeout(() => setMessage(null), 5000);
      fetchSeries(fyId);
    } catch (err: unknown) {
      console.error('Reserve failed:', err);
      setError('Failed to reserve number');
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
            <h1 className="text-sm font-bold tracking-wide uppercase">Invoice Series</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Atomic document numbering per FY</span>
          </div>
          <button onClick={openNew}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + New Series
          </button>
        </div>

        {/* Filter toolbar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3">
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Fiscal Year</label>
          <select className="border border-slate-300 px-2.5 py-1 text-xs bg-white" value={fyId} onChange={e => setFyId(e.target.value)}>
            {years.map(y => (
              <option key={y.id} value={y.id}>{y.code}{y.isCurrent ? ' (Current)' : ''}</option>
            ))}
          </select>
          {message && <span className="ml-auto text-[11px] font-bold text-green-700 uppercase tracking-widest">{message}</span>}
          {error && <span className="ml-auto text-[11px] font-bold text-red-700 uppercase tracking-widest">{error}</span>}
        </div>

        {/* Warning banner */}
        <div className="bg-amber-50 border-x border-b border-amber-300 px-4 py-2 -mx-3 md:-mx-6">
          <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700">
            Note: Next number is managed atomically by the system and cannot be edited manually.
          </span>
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-slate-800 text-white">
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Doc Type</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Prefix</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Next Number</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Width</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Active</th>
                <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Sample Preview</th>
                <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">Loading...</td></tr>
              ) : series.length === 0 ? (
                <tr><td colSpan={7} className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No series for this fiscal year</td></tr>
              ) : series.map((s, i) => (
                <tr key={s.id} className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-3 py-1.5 font-bold text-slate-800 border-r border-slate-100">{s.docType}</td>
                  <td className="px-3 py-1.5 font-mono text-slate-700 border-r border-slate-100">{s.prefix}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{s.nextNumber}</td>
                  <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{s.width}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">
                    {s.isActive ? (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-600 bg-green-50 text-green-700">Active</span>
                    ) : (
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-400 bg-slate-50 text-slate-500">Inactive</span>
                    )}
                  </td>
                  <td className="px-3 py-1.5 font-mono text-blue-700 border-r border-slate-100">{formatSample(s)}</td>
                  <td className="px-3 py-1.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(s)}
                        className="px-2 py-0.5 bg-white border border-slate-300 text-slate-600 text-[10px] font-medium hover:bg-slate-50">
                        Edit
                      </button>
                      <button onClick={() => handleReserveTest(s)} disabled={busy}
                        className="px-2 py-0.5 bg-white border border-amber-300 text-amber-700 text-[10px] font-medium hover:bg-amber-50 disabled:opacity-50">
                        Test Reserve
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showNew && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNew(false)}>
          <div className="bg-white shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <span className="text-xs font-bold uppercase tracking-widest">{editing ? 'Edit Invoice Series' : 'New Invoice Series'}</span>
            </div>
            <div className="p-4 space-y-3">
              <div>
                <label className={labelCls}>Doc Type</label>
                <select className={inputCls} value={form.docType} disabled={!!editing}
                  onChange={e => setForm({ ...form, docType: e.target.value })}>
                  {DOC_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Prefix</label>
                <input className={inputCls + ' font-mono'} value={form.prefix}
                  onChange={e => setForm({ ...form, prefix: e.target.value })} placeholder="ETH/26-27/" />
              </div>
              <div>
                <label className={labelCls}>Width</label>
                <input type="number" className={inputCls + ' font-mono tabular-nums'} value={form.width}
                  onChange={e => setForm({ ...form, width: parseInt(e.target.value) || 5 })} />
              </div>
              {!editing && (
                <div>
                  <label className={labelCls}>Start Number</label>
                  <input type="number" className={inputCls + ' font-mono tabular-nums'} value={form.nextNumber}
                    onChange={e => setForm({ ...form, nextNumber: parseInt(e.target.value) || 1 })} />
                </div>
              )}
              <div>
                <label className={labelCls}>Active</label>
                <div className="flex items-center h-[30px]">
                  <input type="checkbox" checked={form.isActive} onChange={e => setForm({ ...form, isActive: e.target.checked })} className="mr-2" />
                  <span className="text-xs text-slate-700">{form.isActive ? 'Active' : 'Inactive'}</span>
                </div>
              </div>
            </div>
            <div className="bg-slate-100 border-t border-slate-300 px-4 py-2 flex items-center justify-end gap-2">
              <button onClick={() => setShowNew(false)}
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
