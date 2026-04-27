import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface PayrollSlip {
  id: string; employeeId: string;
  employee: { employeeCode: string; name: string; department?: { name: string }; division?: string };
  grossEarnings: number; epfEmployee: number; esiEmployee: number; pt: number; tds: number; netPay: number;
  cashAmount?: number; bankAmount?: number; paidStatus?: string;
}

interface PayrollRun {
  id: string; month: number; year: number;
  status: 'DRAFT' | 'PROCESSING' | 'COMPUTED' | 'APPROVED' | 'PAID' | 'CANCELLED';
  totalGross: number; totalDeductions: number; totalNet: number;
  totalEpfEmployee: number; totalEpfEmployer: number;
  totalEsiEmployee: number; totalEsiEmployer: number;
  totalPt: number; totalTds: number; employeeCount: number; createdAt: string;
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'border-slate-300 bg-slate-100 text-slate-600',
  PROCESSING: 'border-blue-300 bg-blue-50 text-blue-700',
  COMPUTED: 'border-blue-400 bg-blue-50 text-blue-700',
  APPROVED: 'border-emerald-400 bg-emerald-50 text-emerald-700',
  PAID: 'border-purple-400 bg-purple-50 text-purple-700',
  CANCELLED: 'border-red-300 bg-red-50 text-red-600',
};

const DIVISION_BADGE: Record<string, string> = {
  SUGAR: 'border-orange-400 bg-orange-50 text-orange-700',
  POWER: 'border-yellow-400 bg-yellow-50 text-yellow-700',
  ETHANOL: 'border-emerald-400 bg-emerald-50 text-emerald-700',
  HQ: 'border-indigo-400 bg-indigo-50 text-indigo-700',
  COMMON: 'border-slate-400 bg-slate-50 text-slate-700',
};

const fmtINR = (n: number): string => {
  if (!n) return '--';
  return '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

export default function Payroll() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [processing, setProcessing] = useState<string | null>(null);
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [slips, setSlips] = useState<Record<string, PayrollSlip[]>>({});
  const [loadingSlips, setLoadingSlips] = useState<string | null>(null);
  const [divisionFilter, setDivisionFilter] = useState('');

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const loadRuns = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/payroll');
      setRuns(res.data.runs || res.data);
    } catch (err) { console.error(err); } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadRuns(); }, [loadRuns]);

  const createRun = async () => {
    setCreating(true);
    try {
      await api.post('/payroll', { month, year });
      loadRuns();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to create run');
    } finally { setCreating(false); }
  };

  const computeRun = async (id: string) => {
    setProcessing(id);
    try { await api.post(`/payroll/${id}/compute`); loadRuns(); if (slips[id]) loadSlips(id); }
    catch (err) { console.error(err); }
    finally { setProcessing(null); }
  };

  const approveRun = async (id: string) => {
    setProcessing(id);
    try { await api.put(`/payroll/${id}/approve`); loadRuns(); }
    catch (err) { console.error(err); } finally { setProcessing(null); }
  };

  const markPaid = async (id: string) => {
    setProcessing(id);
    try { await api.put(`/payroll/${id}/mark-paid`); loadRuns(); }
    catch (err) { console.error(err); } finally { setProcessing(null); }
  };

  const loadSlips = async (runId: string) => {
    setLoadingSlips(runId);
    try {
      const res = await api.get(`/payroll/${runId}`);
      const run = res.data.run || res.data;
      setSlips(prev => ({ ...prev, [runId]: run.lines || [] }));
    } catch (err) { console.error(err); } finally { setLoadingSlips(null); }
  };

  const toggleExpand = (runId: string) => {
    if (expandedRun === runId) setExpandedRun(null);
    else { setExpandedRun(runId); if (!slips[runId]) loadSlips(runId); }
  };

  const downloadFile = (runId: string, type: 'ecr' | 'register' | 'pf-register' | 'esi-register') => {
    window.open(`/api/payroll/${runId}/${type}`, '_blank');
  };

  const sortedRuns = [...runs].sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month));

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Payroll Runs</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">{sortedRuns.length} total · workflow: DRAFT → COMPUTED → APPROVED → PAID</span>
          </div>
          <span className="text-[10px] text-slate-400">Compute → Approve → Pay (use Pay Today tab)</span>
        </div>

        {/* Create new run bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-end gap-3 flex-wrap">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Month</label>
            <select value={month} onChange={e => setMonth(Number(e.target.value))} className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
              {MONTHS.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Year</label>
            <select value={year} onChange={e => setYear(Number(e.target.value))} className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
              {[year - 1, year, year + 1].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <button onClick={createRun} disabled={creating} className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50">
            {creating ? 'Creating...' : '+ Create Run'}
          </button>
          <div className="ml-auto">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Division Filter</label>
            <select value={divisionFilter} onChange={e => setDivisionFilter(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">All</option>
              <option value="SUGAR">Sugar</option>
              <option value="POWER">Power</option>
              <option value="ETHANOL">Ethanol</option>
              <option value="HQ">HQ</option>
              <option value="COMMON">Common</option>
            </select>
          </div>
        </div>

        {/* Runs table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          {loading ? (
            <div className="px-3 py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading payroll runs...</div>
          ) : sortedRuns.length === 0 ? (
            <div className="px-3 py-12 text-center text-xs text-slate-400">No payroll runs yet. Create one above for a specific month + year.</div>
          ) : (
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-800 text-white">
                <th className="w-8 px-2 py-2 border-r border-slate-700"></th>
                {['Period', 'Status', 'Employees', 'Gross', 'Deductions', 'Net Payout', 'Created', 'Actions'].map(h => (
                  <th key={h} className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left last:border-r-0 last:text-right">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {sortedRuns.map((run, i) => {
                  const isExpanded = expandedRun === run.id;
                  return (
                    <>
                      <tr
                        key={run.id}
                        className={`border-b border-slate-100 hover:bg-blue-50/40 cursor-pointer ${i % 2 ? 'bg-slate-50/70' : ''} ${isExpanded ? 'bg-blue-50/60' : ''}`}
                        onClick={() => toggleExpand(run.id)}
                      >
                        <td className="px-2 py-1.5 text-center text-slate-400 border-r border-slate-100">{isExpanded ? '\u25BC' : '\u25B6'}</td>
                        <td className="px-3 py-1.5 font-bold border-r border-slate-100">{MONTHS[run.month]} {run.year}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100"><span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_BADGE[run.status] || ''}`}>{run.status}</span></td>
                        <td className="px-3 py-1.5 font-mono tabular-nums border-r border-slate-100">{run.employeeCount}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtINR(run.totalGross)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums text-red-700 border-r border-slate-100">{fmtINR(run.totalDeductions)}</td>
                        <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-emerald-700 border-r border-slate-100">{fmtINR(run.totalNet)}</td>
                        <td className="px-3 py-1.5 font-mono text-[10px] text-slate-500 border-r border-slate-100">{new Date(run.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td>
                        <td className="px-3 py-1.5 text-right">
                          <span className="flex gap-1 justify-end" onClick={e => e.stopPropagation()}>
                            {run.status === 'DRAFT' && (
                              <button onClick={() => computeRun(run.id)} disabled={processing === run.id} className="px-2 py-0.5 bg-blue-600 text-white text-[9px] font-bold uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50">{processing === run.id ? '...' : 'Compute'}</button>
                            )}
                            {run.status === 'COMPUTED' && (
                              <button onClick={() => approveRun(run.id)} disabled={processing === run.id} className="px-2 py-0.5 bg-emerald-600 text-white text-[9px] font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50">{processing === run.id ? '...' : 'Approve'}</button>
                            )}
                            {run.status === 'APPROVED' && (
                              <button onClick={() => markPaid(run.id)} disabled={processing === run.id} className="px-2 py-0.5 bg-purple-600 text-white text-[9px] font-bold uppercase tracking-widest hover:bg-purple-700 disabled:opacity-50">{processing === run.id ? '...' : 'Mark Paid'}</button>
                            )}
                          </span>
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr key={`${run.id}-detail`}>
                          <td colSpan={9} className="p-0 bg-slate-50 border-b border-slate-300">
                            {/* Statutory KPI strip */}
                            <div className="grid grid-cols-2 md:grid-cols-7 gap-0 border-b border-slate-200 bg-white">
                              {[
                                { label: 'Gross', value: run.totalGross, color: 'text-slate-800' },
                                { label: 'EPF Ee', value: run.totalEpfEmployee, color: 'text-blue-700' },
                                { label: 'EPF Er', value: run.totalEpfEmployer, color: 'text-blue-700' },
                                { label: 'ESI Ee', value: run.totalEsiEmployee, color: 'text-indigo-700' },
                                { label: 'ESI Er', value: run.totalEsiEmployer, color: 'text-indigo-700' },
                                { label: 'PT', value: run.totalPt, color: 'text-orange-700' },
                                { label: 'TDS', value: run.totalTds, color: 'text-red-700' },
                              ].map(c => (
                                <div key={c.label} className="px-3 py-2 border-r border-slate-200 last:border-r-0">
                                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{c.label}</div>
                                  <div className={`text-xs font-mono font-bold ${c.color}`}>{fmtINR(c.value)}</div>
                                </div>
                              ))}
                            </div>

                            {/* Action bar */}
                            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-slate-200 bg-slate-100 print:hidden">
                              <button onClick={() => downloadFile(run.id, 'register')} className="px-2 py-1 border border-slate-400 bg-white text-slate-700 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50">↓ Salary Register</button>
                              <button onClick={() => downloadFile(run.id, 'pf-register')} className="px-2 py-1 border border-slate-400 bg-white text-slate-700 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50">↓ PF Register</button>
                              <button onClick={() => downloadFile(run.id, 'esi-register')} className="px-2 py-1 border border-slate-400 bg-white text-slate-700 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50">↓ ESI Register</button>
                              <button onClick={() => downloadFile(run.id, 'ecr')} className="px-2 py-1 border border-slate-400 bg-white text-slate-700 text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50">↓ ECR (EPFO)</button>
                            </div>

                            {/* Slips table */}
                            {loadingSlips === run.id ? (
                              <div className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">Loading slips...</div>
                            ) : slips[run.id] ? (
                              <table className="w-full text-xs">
                                <thead><tr className="bg-slate-700 text-white">
                                  {['Emp #', 'Name', 'Division', 'Department', 'Gross', 'EPF', 'ESI', 'PT', 'TDS', 'Net Pay', 'Cash', 'Bank'].map(h => (
                                    <th key={h} className="px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600 text-left last:border-r-0 last:text-right">{h}</th>
                                  ))}
                                </tr></thead>
                                <tbody>
                                  {slips[run.id]
                                    .filter(s => !divisionFilter || s.employee.division === divisionFilter)
                                    .map((s, j) => (
                                    <tr key={s.id} className={`border-b border-slate-100 hover:bg-blue-50/40 ${j % 2 ? 'bg-slate-50/70' : ''}`}>
                                      <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{s.employee.employeeCode}</td>
                                      <td className="px-2 py-1 font-medium border-r border-slate-100">{s.employee.name}</td>
                                      <td className="px-2 py-1 border-r border-slate-100">
                                        {s.employee.division ? <span className={`text-[9px] font-bold uppercase px-1 py-0.5 border ${DIVISION_BADGE[s.employee.division] || 'border-slate-300'}`}>{s.employee.division}</span> : '--'}
                                      </td>
                                      <td className="px-2 py-1 text-slate-500 border-r border-slate-100">{s.employee.department?.name || '--'}</td>
                                      <td className="px-2 py-1 text-right font-mono tabular-nums border-r border-slate-100">{fmtINR(s.grossEarnings)}</td>
                                      <td className="px-2 py-1 text-right font-mono tabular-nums text-red-700 border-r border-slate-100">{fmtINR(s.epfEmployee)}</td>
                                      <td className="px-2 py-1 text-right font-mono tabular-nums text-red-700 border-r border-slate-100">{fmtINR(s.esiEmployee)}</td>
                                      <td className="px-2 py-1 text-right font-mono tabular-nums text-red-700 border-r border-slate-100">{fmtINR(s.pt)}</td>
                                      <td className="px-2 py-1 text-right font-mono tabular-nums text-red-700 border-r border-slate-100">{fmtINR(s.tds)}</td>
                                      <td className="px-2 py-1 text-right font-mono tabular-nums font-bold text-emerald-700 border-r border-slate-100">{fmtINR(s.netPay)}</td>
                                      <td className="px-2 py-1 text-right font-mono tabular-nums text-amber-700 border-r border-slate-100">{s.cashAmount ? fmtINR(s.cashAmount) : '--'}</td>
                                      <td className="px-2 py-1 text-right font-mono tabular-nums text-indigo-700">{s.bankAmount ? fmtINR(s.bankAmount) : '--'}</td>
                                    </tr>
                                  ))}
                                  {slips[run.id].length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-slate-400">No slips — compute the run first</td></tr>}
                                </tbody>
                              </table>
                            ) : null}
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
      </div>
    </div>
  );
}
