import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Declaration {
  id: string;
  empCode: string;
  name: string;
  pan: string | null;
  panMissing: boolean;
  division: string;
  department: string | null;
  designation: string | null;
  seasonalStatus: string | null;
  ctcAnnual: number;
  taxRegime: 'NEW' | 'OLD';
  declared80C: number;
  declared80D: number;
  declaredHRA: number;
  declaredOther: number;
  rentPaidMonthly: number;
  annualGross: number;
  taxableIncome: number;
  annualTax: number;
  monthlyTds: number;
}

interface Totals {
  employees: number;
  annualGross: number;
  taxableIncome: number;
  annualTax: number;
  monthlyTds: number;
  panMissing: number;
  newRegime: number;
  oldRegime: number;
}

interface Projection {
  employee: any;
  fyCode: string;
  currentMonth: number;
  epfEmployeeAnnual: number;
  ytdGross: number;
  ytdTds: number;
  ytdMonthBreakdown: { month: number; year: number; gross: number; tds: number }[];
  active: any;
  newRegime: any;
  oldRegime: any;
  recommendedRegime: 'NEW' | 'OLD';
  savings: number;
}

const fmtINR = (n: number): string => '₹' + (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const MONTHS_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const REGIME_BADGE: Record<string, string> = {
  NEW: 'border-blue-400 bg-blue-50 text-blue-700',
  OLD: 'border-amber-400 bg-amber-50 text-amber-700',
};

const DIVISION_BADGE: Record<string, string> = {
  SUGAR: 'border-orange-400 bg-orange-50 text-orange-700',
  POWER: 'border-yellow-400 bg-yellow-50 text-yellow-700',
  ETHANOL: 'border-emerald-400 bg-emerald-50 text-emerald-700',
  HQ: 'border-indigo-400 bg-indigo-50 text-indigo-700',
  COMMON: 'border-slate-400 bg-slate-50 text-slate-700',
};

export default function TaxDeclarations() {
  const [list, setList] = useState<Declaration[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [regimeFilter, setRegimeFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [seasonFilter, setSeasonFilter] = useState('');

  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState({
    taxRegime: 'NEW', declared80C: '', declared80D: '', declaredHRA: '', declaredOther: '', rentPaidMonthly: '', pan: '',
  });
  const [saving, setSaving] = useState(false);

  const [projOpen, setProjOpen] = useState<string | null>(null);
  const [proj, setProj] = useState<Projection | null>(null);
  const [projLoading, setProjLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (search) params.search = search;
      if (regimeFilter) params.regime = regimeFilter;
      if (divisionFilter) params.division = divisionFilter;
      if (seasonFilter) params.season = seasonFilter;
      const res = await api.get('/hr/tds/declarations', { params });
      setList(res.data.employees || []);
      setTotals(res.data.totals);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, regimeFilter, divisionFilter, seasonFilter]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (e: Declaration) => {
    setEditingId(e.id);
    setEdit({
      taxRegime: e.taxRegime,
      declared80C: String(e.declared80C || ''),
      declared80D: String(e.declared80D || ''),
      declaredHRA: String(e.declaredHRA || ''),
      declaredOther: String(e.declaredOther || ''),
      rentPaidMonthly: String(e.rentPaidMonthly || ''),
      pan: e.pan || '',
    });
  };

  const cancelEdit = () => { setEditingId(null); };

  const save = async (id: string) => {
    setSaving(true);
    try {
      const payload: any = {
        taxRegime: edit.taxRegime,
        declared80C: edit.declared80C ? Number(edit.declared80C) : 0,
        declared80D: edit.declared80D ? Number(edit.declared80D) : 0,
        declaredHRA: edit.declaredHRA ? Number(edit.declaredHRA) : 0,
        declaredOther: edit.declaredOther ? Number(edit.declaredOther) : 0,
        rentPaidMonthly: edit.rentPaidMonthly ? Number(edit.rentPaidMonthly) : 0,
      };
      if (edit.pan) payload.pan = edit.pan.toUpperCase();
      await api.put(`/hr/tds/declarations/${id}`, payload);
      setEditingId(null);
      await load();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const openProjection = async (id: string) => {
    if (projOpen === id) { setProjOpen(null); setProj(null); return; }
    setProjOpen(id);
    setProj(null);
    setProjLoading(true);
    try {
      const res = await api.get(`/hr/tds/projection/${id}`);
      setProj(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setProjLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Tax Declarations · Section 192</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Manage employee 80C / 80D / HRA / regime · drives monthly TDS in payroll</span>
          </div>
          <div className="text-[10px] text-slate-400">Edits update the master · re-compute payroll to apply</div>
        </div>

        {/* KPI Strip */}
        {totals && (
          <div className="grid grid-cols-2 md:grid-cols-7 gap-0 -mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white">
            {[
              { label: 'Employees', value: totals.employees, color: 'text-slate-800', isCount: true },
              { label: 'New Regime', value: totals.newRegime, color: 'text-blue-700', isCount: true },
              { label: 'Old Regime', value: totals.oldRegime, color: 'text-amber-700', isCount: true },
              { label: 'PAN Missing', value: totals.panMissing, color: 'text-red-700', isCount: true },
              { label: 'Annual Gross', value: totals.annualGross, color: 'text-slate-800' },
              { label: 'Annual Tax', value: totals.annualTax, color: 'text-red-700' },
              { label: 'Monthly TDS', value: totals.monthlyTds, color: 'text-red-700' },
            ].map(c => (
              <div key={c.label} className="px-4 py-2.5 border-r border-slate-200 last:border-r-0">
                <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{c.label}</div>
                <div className={`text-sm font-mono font-bold ${c.color}`}>{c.isCount ? c.value : fmtINR(c.value)}</div>
              </div>
            ))}
          </div>
        )}

        {/* Filters */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-end gap-3 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Search</label>
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Code, name, PAN..." className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Regime</label>
            <select value={regimeFilter} onChange={e => setRegimeFilter(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">All</option>
              <option value="NEW">New</option>
              <option value="OLD">Old</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Division</label>
            <select value={divisionFilter} onChange={e => setDivisionFilter(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">All</option>
              <option value="SUGAR">Sugar</option>
              <option value="POWER">Power</option>
              <option value="ETHANOL">Ethanol</option>
              <option value="HQ">HQ</option>
              <option value="COMMON">Common</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Season</label>
            <select value={seasonFilter} onChange={e => setSeasonFilter(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">All</option>
              <option value="OFF_SEASONAL">Off-Seasonal (year-round)</option>
              <option value="SEASONAL">Seasonal (crushing)</option>
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
          {loading ? (
            <div className="px-3 py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading declarations...</div>
          ) : list.length === 0 ? (
            <div className="px-3 py-12 text-center text-xs text-slate-400">No employees match the filters.</div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-800 text-white">
                {['Emp #', 'Name / Dept', 'Division', 'Season', 'PAN', 'Regime', 'CTC', '80C', '80D', 'HRA', 'Rent/mo', 'Other', 'Annual Tax', 'Monthly TDS', 'Actions'].map(h => (
                  <th key={h} className="px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left last:border-r-0 last:text-right">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {list.map((e, i) => {
                  const isEditing = editingId === e.id;
                  const isProj = projOpen === e.id;
                  return (
                    <>
                      <tr key={e.id} className={`border-b border-slate-100 hover:bg-blue-50/40 ${i % 2 ? 'bg-slate-50/70' : ''} ${isProj ? 'bg-blue-50/50' : ''}`}>
                        <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{e.empCode}</td>
                        <td className="px-2 py-1 border-r border-slate-100">
                          <div className="font-medium">{e.name}</div>
                          <div className="text-[10px] text-slate-500">{e.department || '—'} · {e.designation || '—'}</div>
                        </td>
                        <td className="px-2 py-1 border-r border-slate-100">
                          <span className={`text-[9px] font-bold uppercase px-1 py-0.5 border ${DIVISION_BADGE[e.division] || 'border-slate-300'}`}>{e.division}</span>
                        </td>
                        <td className="px-2 py-1 border-r border-slate-100">
                          {e.seasonalStatus === 'SEASONAL' ? (
                            <span className="text-[9px] font-bold uppercase px-1 py-0.5 border border-orange-400 bg-orange-50 text-orange-700">SEASONAL</span>
                          ) : e.seasonalStatus === 'OFF_SEASONAL' ? (
                            <span className="text-[9px] font-bold uppercase px-1 py-0.5 border border-emerald-400 bg-emerald-50 text-emerald-700">OFF-SEAS</span>
                          ) : (
                            <span className="text-[9px] text-slate-400">—</span>
                          )}
                        </td>
                        <td className="px-2 py-1 font-mono border-r border-slate-100">
                          {isEditing ? (
                            <input type="text" value={edit.pan} onChange={ev => setEdit({ ...edit, pan: ev.target.value.toUpperCase() })} maxLength={10} className="w-24 border border-blue-400 px-1 py-0.5 text-[10px]" />
                          ) : e.pan ? (
                            <span className="text-[10px]">{e.pan}</span>
                          ) : (
                            <span className="text-[9px] font-bold text-red-700 bg-red-50 border border-red-300 px-1 py-0.5">MISSING</span>
                          )}
                        </td>
                        <td className="px-2 py-1 border-r border-slate-100">
                          {isEditing ? (
                            <select value={edit.taxRegime} onChange={ev => setEdit({ ...edit, taxRegime: ev.target.value })} className="border border-blue-400 px-1 py-0.5 text-[10px]">
                              <option value="NEW">NEW</option>
                              <option value="OLD">OLD</option>
                            </select>
                          ) : (
                            <span className={`text-[9px] font-bold uppercase px-1 py-0.5 border ${REGIME_BADGE[e.taxRegime]}`}>{e.taxRegime}</span>
                          )}
                        </td>
                        <td className="px-2 py-1 text-right font-mono tabular-nums border-r border-slate-100">{fmtINR(e.ctcAnnual)}</td>
                        <td className="px-2 py-1 text-right font-mono tabular-nums border-r border-slate-100">
                          {isEditing ? (
                            <input type="number" value={edit.declared80C} onChange={ev => setEdit({ ...edit, declared80C: ev.target.value })} className="w-20 border border-blue-400 px-1 py-0.5 text-[10px] text-right" />
                          ) : fmtINR(e.declared80C)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono tabular-nums border-r border-slate-100">
                          {isEditing ? (
                            <input type="number" value={edit.declared80D} onChange={ev => setEdit({ ...edit, declared80D: ev.target.value })} className="w-20 border border-blue-400 px-1 py-0.5 text-[10px] text-right" />
                          ) : fmtINR(e.declared80D)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono tabular-nums border-r border-slate-100">
                          {isEditing ? (
                            <input type="number" value={edit.declaredHRA} onChange={ev => setEdit({ ...edit, declaredHRA: ev.target.value })} className="w-20 border border-blue-400 px-1 py-0.5 text-[10px] text-right" />
                          ) : fmtINR(e.declaredHRA)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono tabular-nums border-r border-slate-100">
                          {isEditing ? (
                            <input type="number" value={edit.rentPaidMonthly} onChange={ev => setEdit({ ...edit, rentPaidMonthly: ev.target.value })} className="w-20 border border-blue-400 px-1 py-0.5 text-[10px] text-right" />
                          ) : fmtINR(e.rentPaidMonthly)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono tabular-nums border-r border-slate-100">
                          {isEditing ? (
                            <input type="number" value={edit.declaredOther} onChange={ev => setEdit({ ...edit, declaredOther: ev.target.value })} className="w-20 border border-blue-400 px-1 py-0.5 text-[10px] text-right" />
                          ) : fmtINR(e.declaredOther)}
                        </td>
                        <td className="px-2 py-1 text-right font-mono tabular-nums text-red-700 border-r border-slate-100">{fmtINR(e.annualTax)}</td>
                        <td className="px-2 py-1 text-right font-mono tabular-nums font-bold text-red-700 border-r border-slate-100">{fmtINR(e.monthlyTds)}</td>
                        <td className="px-2 py-1 text-right">
                          <span className="flex gap-1 justify-end">
                            {isEditing ? (
                              <>
                                <button onClick={() => save(e.id)} disabled={saving} className="px-2 py-0.5 bg-emerald-600 text-white text-[9px] font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50">{saving ? '...' : 'Save'}</button>
                                <button onClick={cancelEdit} className="px-2 py-0.5 border border-slate-400 bg-white text-slate-700 text-[9px] font-bold uppercase tracking-widest hover:bg-slate-50">Cancel</button>
                              </>
                            ) : (
                              <>
                                <button onClick={() => openProjection(e.id)} className="px-2 py-0.5 border border-blue-400 bg-blue-50 text-blue-700 text-[9px] font-bold uppercase tracking-widest hover:bg-blue-100">{isProj ? 'Hide' : 'Projection'}</button>
                                <button onClick={() => startEdit(e)} className="px-2 py-0.5 border border-slate-400 bg-white text-slate-700 text-[9px] font-bold uppercase tracking-widest hover:bg-slate-50">Edit</button>
                              </>
                            )}
                          </span>
                        </td>
                      </tr>
                      {isProj && (
                        <tr key={`${e.id}-proj`}>
                          <td colSpan={15} className="p-0 bg-slate-50 border-b border-slate-300">
                            {projLoading || !proj ? (
                              <div className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">Loading projection...</div>
                            ) : (
                              <div className="px-4 py-3 space-y-3">
                                <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500">FY {proj.fyCode} · Projection vs YTD · Recommended: <span className={`px-1 ${proj.recommendedRegime === 'NEW' ? 'text-blue-700' : 'text-amber-700'}`}>{proj.recommendedRegime}</span> regime (saves {fmtINR(proj.savings)})</div>
                                <div className="grid grid-cols-2 gap-3">
                                  {/* New Regime */}
                                  <div className={`border p-3 ${proj.employee.taxRegime === 'NEW' ? 'border-blue-500 bg-blue-50/30' : 'border-slate-300 bg-white'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="text-[10px] font-bold uppercase tracking-widest text-blue-700">New Regime · Active: {proj.employee.taxRegime === 'NEW' ? 'Yes' : 'No'}</div>
                                      <div className="text-[9px] text-slate-500">Std Ded ₹75,000 · No 80C/D · 87A till ₹12L</div>
                                    </div>
                                    <table className="w-full text-[11px]">
                                      <tbody>
                                        <tr><td className="text-slate-500 py-0.5">Annual Gross</td><td className="text-right font-mono">{fmtINR(proj.newRegime.annualGross)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5">Standard Deduction</td><td className="text-right font-mono">- {fmtINR(proj.newRegime.standardDeduction)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5 font-medium border-t">Taxable Income</td><td className="text-right font-mono font-medium border-t">{fmtINR(proj.newRegime.taxableIncome)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5">Tax (slab)</td><td className="text-right font-mono">{fmtINR(proj.newRegime.taxBeforeRebate)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5">Rebate 87A</td><td className="text-right font-mono text-emerald-700">- {fmtINR(proj.newRegime.rebate87A)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5">Cess 4%</td><td className="text-right font-mono">+ {fmtINR(proj.newRegime.cess)}</td></tr>
                                        <tr><td className="font-bold py-1 border-t">Annual Tax</td><td className="text-right font-mono font-bold text-red-700 border-t">{fmtINR(proj.newRegime.annualTax)}</td></tr>
                                      </tbody>
                                    </table>
                                  </div>
                                  {/* Old Regime */}
                                  <div className={`border p-3 ${proj.employee.taxRegime === 'OLD' ? 'border-amber-500 bg-amber-50/30' : 'border-slate-300 bg-white'}`}>
                                    <div className="flex items-center justify-between mb-2">
                                      <div className="text-[10px] font-bold uppercase tracking-widest text-amber-700">Old Regime · Active: {proj.employee.taxRegime === 'OLD' ? 'Yes' : 'No'}</div>
                                      <div className="text-[9px] text-slate-500">Std Ded ₹50,000 · 80C cap ₹1.5L · 87A till ₹5L</div>
                                    </div>
                                    <table className="w-full text-[11px]">
                                      <tbody>
                                        <tr><td className="text-slate-500 py-0.5">Annual Gross</td><td className="text-right font-mono">{fmtINR(proj.oldRegime.annualGross)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5">Standard Deduction</td><td className="text-right font-mono">- {fmtINR(proj.oldRegime.standardDeduction)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5">80C (incl EPF {fmtINR(proj.epfEmployeeAnnual)})</td><td className="text-right font-mono">- {fmtINR(proj.oldRegime.section80C)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5">80D (medical)</td><td className="text-right font-mono">- {fmtINR(proj.oldRegime.section80D)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5">Other deductions</td><td className="text-right font-mono">- {fmtINR(proj.oldRegime.otherDeductions)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5 font-medium border-t">Taxable Income</td><td className="text-right font-mono font-medium border-t">{fmtINR(proj.oldRegime.taxableIncome)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5">Tax (slab)</td><td className="text-right font-mono">{fmtINR(proj.oldRegime.taxBeforeRebate)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5">Rebate 87A</td><td className="text-right font-mono text-emerald-700">- {fmtINR(proj.oldRegime.rebate87A)}</td></tr>
                                        <tr><td className="text-slate-500 py-0.5">Cess 4%</td><td className="text-right font-mono">+ {fmtINR(proj.oldRegime.cess)}</td></tr>
                                        <tr><td className="font-bold py-1 border-t">Annual Tax</td><td className="text-right font-mono font-bold text-red-700 border-t">{fmtINR(proj.oldRegime.annualTax)}</td></tr>
                                      </tbody>
                                    </table>
                                  </div>
                                </div>

                                {/* YTD breakdown */}
                                {proj.ytdMonthBreakdown.length > 0 && (
                                  <div className="bg-white border border-slate-300 p-3">
                                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-2">YTD Salary &amp; TDS · {proj.ytdMonthBreakdown.length} month(s) processed</div>
                                    <div className="grid grid-cols-12 gap-2">
                                      {proj.ytdMonthBreakdown.map(m => (
                                        <div key={`${m.year}-${m.month}`} className="border border-slate-200 px-2 py-1">
                                          <div className="text-[9px] text-slate-500">{MONTHS_SHORT[m.month]} {String(m.year).slice(-2)}</div>
                                          <div className="text-[10px] font-mono font-medium">{fmtINR(m.gross)}</div>
                                          <div className="text-[10px] font-mono text-red-700">{fmtINR(m.tds)}</div>
                                        </div>
                                      ))}
                                    </div>
                                    <div className="text-[10px] mt-2 font-mono">YTD Gross: <span className="font-bold">{fmtINR(proj.ytdGross)}</span> · YTD TDS: <span className="font-bold text-red-700">{fmtINR(proj.ytdTds)}</span> · Remaining annual tax: <span className="font-bold text-red-700">{fmtINR(Math.max(0, proj.active.annualTax - proj.ytdTds))}</span></div>
                                  </div>
                                )}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div className="px-4 py-2 -mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-50 text-[10px] text-slate-500">
          <strong>Note:</strong> Edits update the master only — re-compute the current month's payroll run to reflect changes in monthly TDS. Rebate 87A applies if taxable ≤ ₹12L (NEW) / ₹5L (OLD). PAN missing triggers Section 206AA → 20% override during compute.
        </div>
      </div>
    </div>
  );
}
