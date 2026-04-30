import { useState, useCallback } from 'react';
import api from '../../services/api';

const fmtINR = (n: number): string => {
  if (!n) return '\u20B9 0';
  return '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const DIVISIONS = [
  { value: '', label: 'All Divisions', color: 'border-slate-400' },
  { value: 'SUGAR', label: 'Sugar', color: 'border-orange-500' },
  { value: 'POWER', label: 'Power', color: 'border-yellow-500' },
  { value: 'ETHANOL', label: 'Ethanol', color: 'border-emerald-500' },
  { value: 'HQ', label: 'HQ / Head Office', color: 'border-indigo-500' },
  { value: 'COMMON', label: 'Common', color: 'border-slate-500' },
];

const STRATEGIES = [
  { value: 'OLDEST_FIRST', label: 'Employee Code (default)' },
  { value: 'SMALLEST_FIRST', label: 'Smallest first (max coverage)' },
  { value: 'LARGEST_FIRST', label: 'Largest first (clear arrears)' },
  { value: 'BY_DIVISION', label: 'Group by division' },
];

const PAY_MODES = [
  { value: 'BOTH', label: 'Cash + Bank (full salary)' },
  { value: 'CASH', label: 'Cash portion only' },
  { value: 'BANK', label: 'Bank portion only' },
];

interface PayableEmp {
  payrollLineId: string;
  employeeId: string;
  empCode: string;
  name: string;
  division: string;
  department: string | null;
  hasBank: boolean;
  netPay: number;
  cashAmount: number;
  bankAmount: number;
  cashRemaining: number;
  bankRemaining: number;
  due: number;
  paidStatus: string;
}

interface PlanResponse {
  runId: string;
  runMonth: number;
  runYear: number;
  budget: number;
  payMode: string;
  strategy: string;
  division: string | null;
  canFullyPay: PayableEmp[];
  wouldNeedMore: PayableEmp[];
  summary: {
    employeesPayable: number;
    totalEmployees: number;
    totalUsed: number;
    leftOver: number;
    shortfall: number;
    cashNeeded: number;
    bankNeeded: number;
  };
  byDivision: { division: string; count: number; cash: number; bank: number; total: number }[];
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export default function PayToday() {
  const [budget, setBudget] = useState('');
  const [payMode, setPayMode] = useState('BOTH');
  const [division, setDivision] = useState('');
  const [strategy, setStrategy] = useState('OLDEST_FIRST');
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState('');
  const [doneMsg, setDoneMsg] = useState('');

  const runPlan = useCallback(async () => {
    setError(''); setDoneMsg('');
    if (!budget || Number(budget) <= 0) { setError('Enter a budget greater than 0'); return; }
    setLoading(true);
    try {
      const res = await api.post<PlanResponse>('/payroll/pay-today/plan', {
        budget: Number(budget),
        payMode,
        division: division || undefined,
        strategy,
      });
      setPlan(res.data);
      setSelected(new Set(res.data.canFullyPay.map(e => e.payrollLineId)));
    } catch (err: unknown) {
      setError(err.response?.data?.error || 'Failed to compute plan');
      setPlan(null);
    } finally { setLoading(false); }
  }, [budget, payMode, division, strategy]);

  const toggleEmp = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const execute = useCallback(async () => {
    if (!plan || selected.size === 0) return;
    if (!confirm(`Mark ${selected.size} employees as paid via ${payMode}? This will update payroll records.`)) return;
    setExecuting(true); setError(''); setDoneMsg('');
    try {
      const res = await api.post('/payroll/pay-today/execute', {
        payrollLineIds: Array.from(selected),
        payMode,
        paidDate: new Date().toISOString().slice(0, 10),
      });
      setDoneMsg(`✓ Marked ${res.data.updated} payroll lines as paid via ${payMode}.`);
      setPlan(null); setSelected(new Set()); setBudget('');
    } catch (err: unknown) {
      setError(err.response?.data?.error || 'Failed to execute');
    } finally { setExecuting(false); }
  }, [plan, selected, payMode]);

  const selectedTotal = plan ? plan.canFullyPay.filter(e => selected.has(e.payrollLineId)).reduce((s, e) => s + e.due, 0) : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Pay Today — Cash & Bank Disbursement</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Tell me your budget — I'll tell you who you can pay</span>
          </div>
        </div>

        {/* Input panel */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-4">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-3">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Budget Available Today (₹)</label>
              <input
                type="number"
                value={budget}
                onChange={e => setBudget(e.target.value)}
                placeholder="e.g. 500000"
                className="w-full border border-slate-300 px-3 py-2 text-base font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              {budget && Number(budget) > 0 && <p className="text-[10px] text-slate-500 mt-0.5">{fmtINR(Number(budget))}</p>}
            </div>
            <div className="md:col-span-3">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Pay Mode</label>
              <select value={payMode} onChange={e => setPayMode(e.target.value)} className="w-full border border-slate-300 px-2.5 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                {PAY_MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Division Filter</label>
              <select value={division} onChange={e => setDivision(e.target.value)} className="w-full border border-slate-300 px-2.5 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                {DIVISIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Order</label>
              <select value={strategy} onChange={e => setStrategy(e.target.value)} className="w-full border border-slate-300 px-2.5 py-2 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                {STRATEGIES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <button
                onClick={runPlan}
                disabled={loading || !budget}
                className="w-full px-3 py-2 bg-blue-600 text-white text-xs font-bold uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50"
              >{loading ? 'Computing...' : 'Show Plan →'}</button>
            </div>
          </div>
          {error && <div className="mt-3 px-3 py-2 bg-red-50 border border-red-300 text-red-700 text-xs">{error}</div>}
          {doneMsg && <div className="mt-3 px-3 py-2 bg-emerald-50 border border-emerald-300 text-emerald-700 text-xs">{doneMsg}</div>}
        </div>

        {plan && (
          <>
            {/* KPI Strip */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Employees You Can Pay</div>
                <div className="text-2xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{plan.summary.employeesPayable}</div>
                <div className="text-[9px] text-slate-400 mt-0.5">of {plan.summary.totalEmployees} unpaid</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-emerald-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Payout</div>
                <div className="text-xl font-bold text-emerald-700 mt-1 font-mono tabular-nums">{fmtINR(plan.summary.totalUsed)}</div>
                <div className="text-[9px] text-slate-400 mt-0.5">used from your budget</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cash Required</div>
                <div className="text-xl font-bold text-amber-700 mt-1 font-mono tabular-nums">{fmtINR(plan.summary.cashNeeded)}</div>
                <div className="text-[9px] text-slate-400 mt-0.5">physical cash to disburse</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-indigo-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Bank Transfer Required</div>
                <div className="text-xl font-bold text-indigo-700 mt-1 font-mono tabular-nums">{fmtINR(plan.summary.bankNeeded)}</div>
                <div className="text-[9px] text-slate-400 mt-0.5">via NEFT / RTGS</div>
              </div>
              <div className="bg-white px-4 py-3 border-l-4 border-l-slate-400">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Left Over</div>
                <div className="text-xl font-bold text-slate-700 mt-1 font-mono tabular-nums">{fmtINR(plan.summary.leftOver)}</div>
                <div className="text-[9px] text-slate-400 mt-0.5">{plan.summary.shortfall > 0 ? `Need ${fmtINR(plan.summary.shortfall)} more for next` : 'all surplus'}</div>
              </div>
            </div>

            {/* Division-wise summary */}
            {plan.byDivision.length > 0 && (
              <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
                <div className="bg-slate-200 border-b border-slate-300 px-3 py-1.5">
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Division-wise Breakdown — Payroll {MONTHS[plan.runMonth]} {plan.runYear}</span>
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-700 text-white">
                    {['Division', 'Employees', 'Cash Portion', 'Bank Portion', 'Total'].map(h => (
                      <th key={h} className="px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600 text-left last:border-r-0 last:text-right">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {plan.byDivision.sort((a, b) => b.total - a.total).map((d) => {
                      const divInfo = DIVISIONS.find(x => x.value === d.division);
                      return (
                        <tr key={d.division} className={`border-b border-slate-100 hover:bg-blue-50/60 border-l-4 ${divInfo?.color || 'border-l-slate-300'}`}>
                          <td className="px-3 py-1.5 font-bold border-r border-slate-100">{divInfo?.label || d.division}</td>
                          <td className="px-3 py-1.5 font-mono border-r border-slate-100">{d.count}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-amber-700 border-r border-slate-100">{fmtINR(d.cash)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums text-indigo-700 border-r border-slate-100">{fmtINR(d.bank)}</td>
                          <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold">{fmtINR(d.total)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot><tr className="bg-slate-800 text-white font-bold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 font-mono">{plan.summary.employeesPayable}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtINR(plan.summary.cashNeeded)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtINR(plan.summary.bankNeeded)}</td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtINR(plan.summary.totalUsed)}</td>
                  </tr></tfoot>
                </table>
              </div>
            )}

            {/* Action bar */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-100 px-4 py-2 flex items-center gap-3 print:hidden">
              <span className="text-[11px] text-slate-600">
                <strong>{selected.size}</strong> selected · {fmtINR(selectedTotal)} total
              </span>
              <button onClick={() => setSelected(new Set(plan.canFullyPay.map(e => e.payrollLineId)))} className="text-[10px] text-blue-600 hover:underline uppercase tracking-widest">Select all</button>
              <button onClick={() => setSelected(new Set())} className="text-[10px] text-blue-600 hover:underline uppercase tracking-widest">Clear</button>
              <button
                onClick={execute}
                disabled={executing || selected.size === 0}
                className="ml-auto px-4 py-1.5 bg-emerald-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-40"
              >{executing ? 'Marking paid...' : `Mark ${selected.size} as Paid (${payMode})`}</button>
            </div>

            {/* Employees who CAN be paid */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
              <div className="bg-emerald-100 border-b border-emerald-300 px-3 py-1.5 flex items-center justify-between">
                <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest">✓ {plan.canFullyPay.length} Employees You Can Fully Pay</span>
                <span className="text-[10px] text-emerald-700">Total {fmtINR(plan.summary.totalUsed)}</span>
              </div>
              <table className="w-full text-xs">
                <thead><tr className="bg-slate-800 text-white">
                  <th className="w-8 px-2 py-1.5 border-r border-slate-700"></th>
                  {['Emp #', 'Name', 'Division', 'Department', 'Cash', 'Bank', 'Net Pay', 'Bank A/c?'].map(h => (
                    <th key={h} className="px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left last:border-r-0 last:text-center">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {plan.canFullyPay.map((e, i) => (
                    <tr key={e.payrollLineId} className={`border-b border-slate-100 hover:bg-emerald-50/40 ${i % 2 ? 'bg-slate-50/70' : ''} ${selected.has(e.payrollLineId) ? 'bg-emerald-50' : ''}`}>
                      <td className="px-2 py-1 text-center border-r border-slate-100">
                        <input type="checkbox" checked={selected.has(e.payrollLineId)} onChange={() => toggleEmp(e.payrollLineId)} className="w-3 h-3" />
                      </td>
                      <td className="px-3 py-1 font-mono text-[10px] border-r border-slate-100">{e.empCode}</td>
                      <td className="px-3 py-1 font-medium border-r border-slate-100">{e.name}</td>
                      <td className="px-3 py-1 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${DIVISIONS.find(d => d.value === e.division)?.color.replace('border-', 'border-') || 'border-slate-300'} bg-slate-50 text-slate-700`}>{e.division}</span>
                      </td>
                      <td className="px-3 py-1 text-slate-500 border-r border-slate-100">{e.department || '--'}</td>
                      <td className="px-3 py-1 text-right font-mono tabular-nums text-amber-700 border-r border-slate-100">{e.cashRemaining > 0 ? fmtINR(e.cashRemaining) : '--'}</td>
                      <td className="px-3 py-1 text-right font-mono tabular-nums text-indigo-700 border-r border-slate-100">{e.bankRemaining > 0 ? fmtINR(e.bankRemaining) : '--'}</td>
                      <td className="px-3 py-1 text-right font-mono tabular-nums font-bold border-r border-slate-100">{fmtINR(e.due)}</td>
                      <td className="px-3 py-1 text-center">
                        {e.hasBank
                          ? <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-emerald-400 bg-emerald-50 text-emerald-700">YES</span>
                          : <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-amber-400 bg-amber-50 text-amber-700">NO BANK</span>}
                      </td>
                    </tr>
                  ))}
                  {plan.canFullyPay.length === 0 && <tr><td colSpan={9} className="px-3 py-8 text-center text-slate-400">Budget is too small for any single employee in this filter.</td></tr>}
                </tbody>
              </table>
            </div>

            {/* Employees over budget — informational */}
            {plan.wouldNeedMore.length > 0 && (
              <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
                <div className="bg-amber-100 border-b border-amber-300 px-3 py-1.5">
                  <span className="text-[10px] font-bold text-amber-800 uppercase tracking-widest">⚠ {plan.wouldNeedMore.length} Employees Over Remaining Budget</span>
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-700 text-white">
                    {['Emp #', 'Name', 'Division', 'Net Pay', 'Due', 'Short by'].map(h => (
                      <th key={h} className="px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600 text-left last:border-r-0 last:text-right">{h}</th>
                    ))}
                  </tr></thead>
                  <tbody>
                    {plan.wouldNeedMore.slice(0, 20).map((e, i) => (
                      <tr key={e.payrollLineId} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                        <td className="px-3 py-1 font-mono text-[10px] border-r border-slate-100">{e.empCode}</td>
                        <td className="px-3 py-1 border-r border-slate-100">{e.name}</td>
                        <td className="px-3 py-1 border-r border-slate-100">{e.division}</td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">{fmtINR(e.netPay)}</td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums font-bold border-r border-slate-100">{fmtINR(e.due)}</td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums text-red-600">{fmtINR(e.due - plan.summary.leftOver)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {!plan && !loading && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white px-6 py-12 text-center">
            <div className="text-sm text-slate-400 uppercase tracking-widest mb-2">Enter a budget to see the plan</div>
            <div className="text-[11px] text-slate-500 max-w-md mx-auto">
              The system will look at the most recent computed payroll run, find unpaid employees in the selected division, and tell you exactly how many you can pay with the cash you have on hand.
            </div>
            <div className="text-[11px] text-slate-500 max-w-md mx-auto mt-3">
              Each employee's salary can be split into a <strong className="text-amber-700">cash portion</strong> and a <strong className="text-indigo-700">bank portion</strong> — set this on the employee master via <code>cashPayPercent</code>.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
