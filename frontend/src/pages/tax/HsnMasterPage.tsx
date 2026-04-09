import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface GstRate {
  id: string;
  hsnId: string;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  isExempt: boolean;
  isOutsideGst: boolean;
  conditionNote: string | null;
  effectiveFrom: string;
  effectiveTill: string | null;
}

interface HsnCode {
  id: string;
  code: string;
  description: string;
  uqc: string;
  category: string;
  isActive: boolean;
  currentRate?: GstRate | null;
  rates?: GstRate[];
}

const CATEGORIES = ['ALL', 'FINISHED_GOOD', 'RAW_MATERIAL', 'BYPRODUCT', 'SERVICE'];

function fmtDate(d: string | null): string {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isCurrent(rate: GstRate): boolean {
  const now = Date.now();
  if (new Date(rate.effectiveFrom).getTime() > now) return false;
  if (rate.effectiveTill && new Date(rate.effectiveTill).getTime() < now) return false;
  return true;
}

interface HsnForm {
  code: string;
  description: string;
  uqc: string;
  category: string;
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  isExempt: boolean;
  isOutsideGst: boolean;
  conditionNote: string;
  effectiveFrom: string;
}

interface RateForm {
  cgst: number;
  sgst: number;
  igst: number;
  cess: number;
  isExempt: boolean;
  isOutsideGst: boolean;
  conditionNote: string;
  effectiveFrom: string;
}

const EMPTY_HSN: HsnForm = {
  code: '', description: '', uqc: 'KGS', category: 'FINISHED_GOOD',
  cgst: 9, sgst: 9, igst: 18, cess: 0, isExempt: false, isOutsideGst: false, conditionNote: '', effectiveFrom: '',
};

const EMPTY_RATE: RateForm = {
  cgst: 0, sgst: 0, igst: 0, cess: 0, isExempt: false, isOutsideGst: false, conditionNote: '', effectiveFrom: '',
};

export default function HsnMasterPage() {
  const [list, setList] = useState<HsnCode[]>([]);
  const [selected, setSelected] = useState<HsnCode | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('ALL');
  const [showNewHsn, setShowNewHsn] = useState(false);
  const [showAddRate, setShowAddRate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hsnForm, setHsnForm] = useState<HsnForm>(EMPTY_HSN);
  const [rateForm, setRateForm] = useState<RateForm>(EMPTY_RATE);

  const fetchList = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await api.get<HsnCode[]>('/tax/hsn');
      setList(res.data || []);
    } catch (err: unknown) {
      console.error('Failed to fetch HSN:', err);
      setError('Failed to load HSN codes');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchDetail = useCallback(async (id: string) => {
    try {
      const res = await api.get<HsnCode>(`/tax/hsn/${id}`);
      setSelected(res.data);
    } catch (err: unknown) {
      console.error('Failed to fetch HSN detail:', err);
    }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  const filtered = list.filter(h => {
    if (category !== 'ALL' && h.category !== category) return false;
    if (search && !h.code.toLowerCase().includes(search.toLowerCase()) && !h.description.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const handleSelect = (h: HsnCode) => {
    setSelected(h);
    fetchDetail(h.id);
  };

  const handleCreateHsn = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/tax/hsn', {
        code: hsnForm.code,
        description: hsnForm.description,
        uqc: hsnForm.uqc,
        category: hsnForm.category,
        cgst: hsnForm.cgst,
        sgst: hsnForm.sgst,
        igst: hsnForm.igst,
        cess: hsnForm.cess,
        isExempt: hsnForm.isExempt,
        isOutsideGst: hsnForm.isOutsideGst,
        conditionNote: hsnForm.conditionNote || null,
        effectiveFrom: hsnForm.effectiveFrom ? new Date(hsnForm.effectiveFrom).toISOString() : new Date().toISOString(),
      });
      setShowNewHsn(false);
      setHsnForm(EMPTY_HSN);
      fetchList();
    } catch (err: unknown) {
      console.error('Create failed:', err);
      setError('Failed to create HSN');
    } finally {
      setBusy(false);
    }
  };

  const handleAddRate = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      await api.post(`/tax/hsn/${selected.id}/rates`, {
        cgst: rateForm.cgst,
        sgst: rateForm.sgst,
        igst: rateForm.igst,
        cess: rateForm.cess,
        isExempt: rateForm.isExempt,
        isOutsideGst: rateForm.isOutsideGst,
        conditionNote: rateForm.conditionNote || null,
        effectiveFrom: rateForm.effectiveFrom ? new Date(rateForm.effectiveFrom).toISOString() : new Date().toISOString(),
      });
      setShowAddRate(false);
      setRateForm(EMPTY_RATE);
      fetchDetail(selected.id);
      fetchList();
    } catch (err: unknown) {
      console.error('Add rate failed:', err);
      setError('Failed to add rate');
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
            <h1 className="text-sm font-bold tracking-wide uppercase">HSN Master</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">GST rates by HSN with effective-dated history</span>
          </div>
          <button onClick={() => setShowNewHsn(true)}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
            + New HSN
          </button>
        </div>

        {/* Filter toolbar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3">
          <input className="border border-slate-300 px-2.5 py-1 text-xs bg-white w-64"
            placeholder="Search HSN code or description..."
            value={search} onChange={e => setSearch(e.target.value)} />
          <select className="border border-slate-300 px-2.5 py-1 text-xs bg-white" value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
          {error && <span className="ml-auto text-[11px] font-bold text-red-700 uppercase tracking-widest">{error}</span>}
        </div>

        {/* Two columns */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-0 -mx-3 md:-mx-6 border-x border-b border-slate-300">
          {/* Left: HSN list */}
          <div className="lg:col-span-2 border-r border-slate-300 bg-white">
            <div className="bg-slate-200 border-b border-slate-300 px-4 py-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">HSN Codes ({filtered.length})</span>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {loading ? (
                <div className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
              ) : filtered.length === 0 ? (
                <div className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No HSN codes</div>
              ) : (
                <table className="w-full text-xs">
                  <tbody>
                    {filtered.map((h, i) => {
                      const isSelected = selected?.id === h.id;
                      return (
                        <tr key={h.id}
                          className={`border-b border-slate-100 cursor-pointer ${isSelected ? 'bg-blue-100' : i % 2 ? 'bg-slate-50/70 hover:bg-blue-50/60' : 'hover:bg-blue-50/60'}`}
                          onClick={() => handleSelect(h)}>
                          <td className="px-3 py-1.5 font-mono font-bold text-slate-800 border-r border-slate-100 w-24">{h.code}</td>
                          <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100 truncate">{h.description}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-600 w-16">
                            {h.currentRate ? (h.currentRate.isExempt ? 'EX' : h.currentRate.isOutsideGst ? 'NGST' : `${h.currentRate.igst}%`) : '--'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>

          {/* Right: detail */}
          <div className="lg:col-span-3 bg-white">
            <div className="bg-slate-200 border-b border-slate-300 px-4 py-2 flex items-center justify-between">
              <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">
                {selected ? `Detail: ${selected.code}` : 'Select an HSN'}
              </span>
              {selected && (
                <button onClick={() => { setRateForm(EMPTY_RATE); setShowAddRate(true); }}
                  className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-medium hover:bg-blue-700">
                  + Add Rate
                </button>
              )}
            </div>
            {!selected ? (
              <div className="px-4 py-10 text-center text-xs text-slate-400 uppercase tracking-widest">No HSN selected</div>
            ) : (
              <div>
                <div className="p-4 border-b border-slate-200 grid grid-cols-2 gap-2">
                  <div>
                    <div className={labelCls}>Code</div>
                    <div className="text-sm font-mono font-bold text-slate-800">{selected.code}</div>
                  </div>
                  <div>
                    <div className={labelCls}>Category</div>
                    <div className="text-xs text-slate-700">{selected.category}</div>
                  </div>
                  <div className="col-span-2">
                    <div className={labelCls}>Description</div>
                    <div className="text-xs text-slate-700">{selected.description}</div>
                  </div>
                  <div>
                    <div className={labelCls}>UQC</div>
                    <div className="text-xs text-slate-700 font-mono">{selected.uqc}</div>
                  </div>
                  <div>
                    <div className={labelCls}>Active</div>
                    <div className="text-xs">
                      {selected.isActive ? (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-600 bg-green-50 text-green-700">Active</span>
                      ) : (
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-400 bg-slate-50 text-slate-500">Inactive</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Rate history */}
                <div className="bg-slate-200 border-y border-slate-300 px-4 py-2">
                  <span className="text-[10px] font-bold uppercase tracking-widest text-slate-600">Rate History</span>
                </div>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">CGST</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">SGST</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">IGST</th>
                      <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Cess</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">From</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Till</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Condition</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(selected.rates || []).length === 0 ? (
                      <tr><td colSpan={8} className="px-4 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No rate history</td></tr>
                    ) : (selected.rates || []).map((r, i) => (
                      <tr key={r.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{r.cgst}%</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{r.sgst}%</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{r.igst}%</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-slate-700 border-r border-slate-100">{r.cess}%</td>
                        <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{fmtDate(r.effectiveFrom)}</td>
                        <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{fmtDate(r.effectiveTill)}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          {isCurrent(r) ? (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-600 bg-green-50 text-green-700">Current</span>
                          ) : (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-400 bg-slate-50 text-slate-500">Historical</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-slate-500 truncate">{r.conditionNote || '--'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modal: New HSN */}
      {showNewHsn && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowNewHsn(false)}>
          <div className="bg-white shadow-2xl w-full max-w-2xl" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <span className="text-xs font-bold uppercase tracking-widest">New HSN Code</span>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Code</label>
                <input className={inputCls + ' font-mono'} value={hsnForm.code}
                  onChange={e => setHsnForm({ ...hsnForm, code: e.target.value })} placeholder="2207 20" />
              </div>
              <div>
                <label className={labelCls}>UQC</label>
                <input className={inputCls + ' font-mono'} value={hsnForm.uqc}
                  onChange={e => setHsnForm({ ...hsnForm, uqc: e.target.value })} placeholder="KLR / KGS / NOS" />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Description</label>
                <input className={inputCls} value={hsnForm.description}
                  onChange={e => setHsnForm({ ...hsnForm, description: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>Category</label>
                <select className={inputCls} value={hsnForm.category}
                  onChange={e => setHsnForm({ ...hsnForm, category: e.target.value })}>
                  {CATEGORIES.filter(c => c !== 'ALL').map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Effective From</label>
                <input type="date" className={inputCls} value={hsnForm.effectiveFrom}
                  onChange={e => setHsnForm({ ...hsnForm, effectiveFrom: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>CGST %</label>
                <input type="number" step="0.01" className={inputCls + ' font-mono tabular-nums'} value={hsnForm.cgst}
                  onChange={e => setHsnForm({ ...hsnForm, cgst: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className={labelCls}>SGST %</label>
                <input type="number" step="0.01" className={inputCls + ' font-mono tabular-nums'} value={hsnForm.sgst}
                  onChange={e => setHsnForm({ ...hsnForm, sgst: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className={labelCls}>IGST %</label>
                <input type="number" step="0.01" className={inputCls + ' font-mono tabular-nums'} value={hsnForm.igst}
                  onChange={e => setHsnForm({ ...hsnForm, igst: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className={labelCls}>Cess %</label>
                <input type="number" step="0.01" className={inputCls + ' font-mono tabular-nums'} value={hsnForm.cess}
                  onChange={e => setHsnForm({ ...hsnForm, cess: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Condition Note</label>
                <input className={inputCls} value={hsnForm.conditionNote}
                  onChange={e => setHsnForm({ ...hsnForm, conditionNote: e.target.value })} placeholder="Optional" />
              </div>
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={hsnForm.isExempt}
                    onChange={e => setHsnForm({ ...hsnForm, isExempt: e.target.checked })} />
                  Exempt
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={hsnForm.isOutsideGst}
                    onChange={e => setHsnForm({ ...hsnForm, isOutsideGst: e.target.checked })} />
                  Outside GST
                </label>
              </div>
            </div>
            <div className="bg-slate-100 border-t border-slate-300 px-4 py-2 flex items-center justify-end gap-2">
              <button onClick={() => setShowNewHsn(false)}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleCreateHsn} disabled={busy}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Add Rate */}
      {showAddRate && selected && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAddRate(false)}>
          <div className="bg-white shadow-2xl w-full max-w-xl" onClick={e => e.stopPropagation()}>
            <div className="bg-slate-800 text-white px-4 py-2.5">
              <span className="text-xs font-bold uppercase tracking-widest">Add Rate — {selected.code}</span>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Effective From</label>
                <input type="date" className={inputCls} value={rateForm.effectiveFrom}
                  onChange={e => setRateForm({ ...rateForm, effectiveFrom: e.target.value })} />
              </div>
              <div>
                <label className={labelCls}>CGST %</label>
                <input type="number" step="0.01" className={inputCls + ' font-mono tabular-nums'} value={rateForm.cgst}
                  onChange={e => setRateForm({ ...rateForm, cgst: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className={labelCls}>SGST %</label>
                <input type="number" step="0.01" className={inputCls + ' font-mono tabular-nums'} value={rateForm.sgst}
                  onChange={e => setRateForm({ ...rateForm, sgst: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className={labelCls}>IGST %</label>
                <input type="number" step="0.01" className={inputCls + ' font-mono tabular-nums'} value={rateForm.igst}
                  onChange={e => setRateForm({ ...rateForm, igst: parseFloat(e.target.value) || 0 })} />
              </div>
              <div>
                <label className={labelCls}>Cess %</label>
                <input type="number" step="0.01" className={inputCls + ' font-mono tabular-nums'} value={rateForm.cess}
                  onChange={e => setRateForm({ ...rateForm, cess: parseFloat(e.target.value) || 0 })} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Condition Note</label>
                <input className={inputCls} value={rateForm.conditionNote}
                  onChange={e => setRateForm({ ...rateForm, conditionNote: e.target.value })} />
              </div>
              <div className="col-span-2 flex items-center gap-4">
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={rateForm.isExempt}
                    onChange={e => setRateForm({ ...rateForm, isExempt: e.target.checked })} />
                  Exempt
                </label>
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={rateForm.isOutsideGst}
                    onChange={e => setRateForm({ ...rateForm, isOutsideGst: e.target.checked })} />
                  Outside GST
                </label>
              </div>
            </div>
            <div className="bg-slate-100 border-t border-slate-300 px-4 py-2 flex items-center justify-end gap-2">
              <button onClick={() => setShowAddRate(false)}
                className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                Cancel
              </button>
              <button onClick={handleAddRate} disabled={busy}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {busy ? 'Saving...' : 'Save Rate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
