import { useState, useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import api from '../../services/api';

interface PayrollRun {
  id: string; month: number; year: number; status: string;
  totalGross: number; totalNet: number; totalDeductions: number;
  totalEpfEmployee: number; totalEpfEmployer: number;
  totalEsiEmployee: number; totalEsiEmployer: number;
  totalPt: number; totalTds: number; employeeCount: number;
  createdAt: string;
}

interface Employee {
  id: string; empCode: string; firstName: string; lastName: string;
  division?: string; department?: { name: string }; designation?: { title: string };
  ctcAnnual?: number; cashPayPercent?: number;
  bankAccount?: string | null; bankIfsc?: string | null;
  status?: string; dateOfJoining?: string; dateOfBirth?: string;
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const DIVISION_COLORS: Record<string, string> = {
  SUGAR: 'border-l-orange-500 text-orange-700 bg-orange-50',
  POWER: 'border-l-yellow-500 text-yellow-700 bg-yellow-50',
  ETHANOL: 'border-l-emerald-500 text-emerald-700 bg-emerald-50',
  HQ: 'border-l-indigo-500 text-indigo-700 bg-indigo-50',
  COMMON: 'border-l-slate-500 text-slate-700 bg-slate-50',
};

const STATUS_BADGE: Record<string, string> = {
  DRAFT: 'border-slate-300 bg-slate-100 text-slate-600',
  PROCESSING: 'border-blue-300 bg-blue-50 text-blue-700',
  COMPUTED: 'border-blue-400 bg-blue-50 text-blue-700',
  APPROVED: 'border-emerald-400 bg-emerald-50 text-emerald-700',
  PAID: 'border-purple-400 bg-purple-50 text-purple-700',
  CANCELLED: 'border-red-300 bg-red-50 text-red-600',
};

const fmtINR = (n: number): string => {
  if (!n) return '\u20B9 0';
  return '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const fmtCompact = (n: number): string => {
  if (!n) return '\u20B9 0';
  if (Math.abs(n) >= 10000000) return '\u20B9' + (n / 10000000).toFixed(2) + ' Cr';
  if (Math.abs(n) >= 100000) return '\u20B9' + (n / 100000).toFixed(2) + ' L';
  return '\u20B9' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
};

const fmtDate = (d: string | undefined): string => {
  if (!d) return '--';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

export default function HrHub() {
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/payroll'),
      api.get('/employees?isActive=true'),
    ]).then(([runsRes, empRes]) => {
      setRuns(runsRes.data.runs || runsRes.data || []);
      setEmployees(empRes.data.employees || empRes.data || []);
    }).catch(console.error).finally(() => setLoading(false));
  }, []);

  const sortedRuns = useMemo(
    () => [...runs].sort((a, b) => (b.year * 100 + b.month) - (a.year * 100 + a.month)),
    [runs]
  );
  const latestRun = sortedRuns[0] || null;
  const last12 = useMemo(() => sortedRuns.slice(0, 12).reverse(), [sortedRuns]);

  // Division-wise headcount
  const byDivision = useMemo(() => {
    const map: Record<string, { division: string; count: number; ctcMonthly: number; cashMonthly: number; bankMonthly: number; noBank: number }> = {};
    for (const e of employees) {
      const d = e.division || 'COMMON';
      if (!map[d]) map[d] = { division: d, count: 0, ctcMonthly: 0, cashMonthly: 0, bankMonthly: 0, noBank: 0 };
      map[d].count++;
      const monthly = (e.ctcAnnual || 0) / 12;
      map[d].ctcMonthly += monthly;
      const cashPct = e.cashPayPercent || 0;
      map[d].cashMonthly += monthly * cashPct / 100;
      map[d].bankMonthly += monthly * (100 - cashPct) / 100;
      if (!e.bankAccount || !e.bankIfsc) map[d].noBank++;
    }
    return Object.values(map).sort((a, b) => b.ctcMonthly - a.ctcMonthly);
  }, [employees]);

  // Setup gaps
  const gapNoBank = employees.filter(e => !e.bankAccount || !e.bankIfsc).length;
  const gapNoCtc = employees.filter(e => !e.ctcAnnual || e.ctcAnnual === 0).length;
  const gapNoDivision = employees.filter(e => !e.division || e.division === 'ETHANOL').length; // default = unset

  // Birthdays + anniversaries this month
  const today = new Date();
  const thisMonth = today.getMonth() + 1;
  const upcomingBirthdays = employees.filter(e => e.dateOfBirth && new Date(e.dateOfBirth).getMonth() + 1 === thisMonth)
    .sort((a, b) => new Date(a.dateOfBirth!).getDate() - new Date(b.dateOfBirth!).getDate())
    .slice(0, 5);
  const workAnniversaries = employees.filter(e => e.dateOfJoining && new Date(e.dateOfJoining).getMonth() + 1 === thisMonth)
    .sort((a, b) => new Date(a.dateOfJoining!).getDate() - new Date(b.dateOfJoining!).getDate())
    .slice(0, 5);

  const totalCtcAnnual = employees.reduce((s, e) => s + (e.ctcAnnual || 0), 0);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-xs text-slate-400 uppercase tracking-widest">Loading HR data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Human Resources</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">{employees.length} active employees · {sortedRuns.length} payroll runs</span>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/hr/pay-today" className="px-3 py-1 bg-emerald-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-700">Pay Today →</Link>
            <Link to="/hr/payroll" className="px-3 py-1 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700">Run Payroll</Link>
          </div>
        </div>

        {/* KPI Strip — always visible */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <Link to="/hr/employees" className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500 hover:bg-slate-50">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Employees</div>
            <div className="text-2xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{employees.length}</div>
            <div className="text-[9px] text-slate-400 mt-0.5">across all divisions</div>
          </Link>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-emerald-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total CTC (Annual)</div>
            <div className="text-xl font-bold text-emerald-700 mt-1 font-mono tabular-nums">{fmtCompact(totalCtcAnnual)}</div>
            <div className="text-[9px] text-slate-400 mt-0.5">{fmtCompact(totalCtcAnnual / 12)} / month</div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-amber-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Latest Payroll</div>
            <div className="text-base font-bold text-slate-800 mt-1">{latestRun ? `${MONTHS[latestRun.month]} ${latestRun.year}` : 'Not started'}</div>
            <div className="text-[9px] mt-0.5">
              {latestRun ? <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_BADGE[latestRun.status] || ''}`}>{latestRun.status}</span> : <span className="text-slate-400">No runs yet</span>}
            </div>
          </div>
          <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-indigo-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Latest Net Payout</div>
            <div className="text-xl font-bold text-indigo-700 mt-1 font-mono tabular-nums">{latestRun ? fmtCompact(latestRun.totalNet) : '--'}</div>
            <div className="text-[9px] text-slate-400 mt-0.5">{latestRun ? `${latestRun.employeeCount} employees` : ''}</div>
          </div>
          <div className="bg-white px-4 py-3 border-l-4 border-l-red-500">
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Statutory (Last Run)</div>
            <div className="text-xl font-bold text-red-700 mt-1 font-mono tabular-nums">{latestRun ? fmtCompact(latestRun.totalEpfEmployer + latestRun.totalEsiEmployer + latestRun.totalPt + latestRun.totalTds) : '--'}</div>
            <div className="text-[9px] text-slate-400 mt-0.5">EPF + ESI + PT + TDS</div>
          </div>
        </div>

        {/* Setup Gap warnings — only if gaps exist */}
        {(gapNoBank > 0 || gapNoCtc > 0) && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-amber-300 bg-amber-50 px-4 py-2 flex items-center gap-4 text-[11px] text-amber-900 flex-wrap">
            <span className="font-bold uppercase tracking-widest text-amber-700">⚠ Setup Gaps</span>
            {gapNoBank > 0 && <span><strong>{gapNoBank}</strong> employees missing bank details — they can only be paid in cash</span>}
            {gapNoCtc > 0 && <span><strong>{gapNoCtc}</strong> employees have no CTC set — they will be skipped from payroll</span>}
            {gapNoDivision > employees.length * 0.5 && <span><strong>{gapNoDivision}</strong> employees on default ETHANOL division — set proper division for cost allocation</span>}
            <Link to="/hr/employees" className="ml-auto px-2 py-0.5 border border-amber-400 bg-white hover:bg-amber-100 font-semibold uppercase tracking-widest text-[10px]">Configure →</Link>
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-0 -mx-3 md:-mx-6 mt-0">
          {/* Left: Division-wise breakdown */}
          <div className="lg:col-span-8 border-x border-b border-slate-300 bg-white overflow-hidden">
            <div className="bg-slate-200 border-b border-slate-300 px-3 py-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Division-wise Workforce & Salary Cost</span>
              <span className="text-[10px] text-slate-500">click to filter Pay-Today by division</span>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-800 text-white">
                {['Division', 'Headcount', 'Monthly CTC', 'Cash / Month', 'Bank / Month', 'Bank Gap', ''].map(h => (
                  <th key={h} className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left last:border-r-0 last:text-center">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {byDivision.map((d) => (
                  <tr key={d.division} className={`border-b border-slate-100 hover:bg-slate-50 border-l-4 ${(DIVISION_COLORS[d.division] || '').split(' ')[0]}`}>
                    <td className="px-3 py-1.5 font-bold border-r border-slate-100">
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${DIVISION_COLORS[d.division] || 'border-slate-300'}`}>{d.division}</span>
                    </td>
                    <td className="px-3 py-1.5 font-mono tabular-nums border-r border-slate-100">{d.count}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold border-r border-slate-100">{fmtCompact(d.ctcMonthly)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-amber-700 border-r border-slate-100">{fmtCompact(d.cashMonthly)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-indigo-700 border-r border-slate-100">{fmtCompact(d.bankMonthly)}</td>
                    <td className="px-3 py-1.5 font-mono tabular-nums text-center border-r border-slate-100">
                      {d.noBank > 0 ? <span className="text-amber-700 font-bold">{d.noBank} of {d.count}</span> : <span className="text-emerald-600">✓</span>}
                    </td>
                    <td className="px-3 py-1.5 text-center">
                      <Link to={`/hr/pay-today?division=${d.division}`} className="text-[10px] text-blue-600 hover:underline uppercase tracking-widest">Pay →</Link>
                    </td>
                  </tr>
                ))}
                {byDivision.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No active employees yet</td></tr>}
              </tbody>
              <tfoot><tr className="bg-slate-800 text-white font-bold">
                <td className="px-3 py-2">Total</td>
                <td className="px-3 py-2 font-mono">{employees.length}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCompact(byDivision.reduce((s, d) => s + d.ctcMonthly, 0))}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCompact(byDivision.reduce((s, d) => s + d.cashMonthly, 0))}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{fmtCompact(byDivision.reduce((s, d) => s + d.bankMonthly, 0))}</td>
                <td colSpan={2} />
              </tr></tfoot>
            </table>

            {/* Recent payroll runs */}
            <div className="bg-slate-200 border-b border-t border-slate-300 px-3 py-1.5 flex items-center justify-between">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Recent Payroll Runs</span>
              <Link to="/hr/payroll" className="text-[10px] text-blue-600 hover:underline uppercase tracking-widest">View all →</Link>
            </div>
            <table className="w-full text-xs">
              <thead><tr className="bg-slate-700 text-white">
                {['Period', 'Status', 'Employees', 'Gross', 'Deductions', 'Net Payout', 'Statutory'].map(h => (
                  <th key={h} className="px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600 text-left last:border-r-0 last:text-right">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {sortedRuns.slice(0, 6).map((r, i) => (
                  <tr key={r.id} className={`border-b border-slate-100 hover:bg-blue-50/40 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                    <td className="px-3 py-1.5 font-medium border-r border-slate-100">{MONTHS_SHORT[r.month]} {r.year}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100"><span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_BADGE[r.status] || ''}`}>{r.status}</span></td>
                    <td className="px-3 py-1.5 font-mono tabular-nums border-r border-slate-100">{r.employeeCount}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums border-r border-slate-100">{fmtCompact(r.totalGross)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-red-700 border-r border-slate-100">{fmtCompact(r.totalDeductions)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums font-bold text-emerald-700 border-r border-slate-100">{fmtCompact(r.totalNet)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums">{fmtCompact(r.totalEpfEmployer + r.totalEsiEmployer + r.totalPt + r.totalTds)}</td>
                  </tr>
                ))}
                {sortedRuns.length === 0 && <tr><td colSpan={7} className="px-3 py-8 text-center text-slate-400">No payroll runs yet — click "Run Payroll" to create one</td></tr>}
              </tbody>
            </table>

            {/* 12-month net payout trend */}
            {last12.length > 1 && (
              <>
                <div className="bg-slate-200 border-b border-t border-slate-300 px-3 py-1.5">
                  <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Last 12 Months — Net Payout Trend</span>
                </div>
                <div className="px-4 py-3">
                  <div className="flex items-end gap-1 h-32">
                    {(() => {
                      const max = Math.max(...last12.map(r => r.totalNet)) || 1;
                      return last12.map(r => {
                        const h = (r.totalNet / max) * 100;
                        return (
                          <div key={r.id} className="flex-1 flex flex-col items-center justify-end h-full">
                            <div className="w-full bg-emerald-500 hover:bg-emerald-600 transition relative group" style={{ height: `${h}%`, minHeight: 2 }}>
                              <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-[10px] px-2 py-0.5 opacity-0 group-hover:opacity-100 whitespace-nowrap pointer-events-none">
                                {fmtCompact(r.totalNet)}
                              </div>
                            </div>
                            <div className="text-[9px] text-slate-500 mt-1 font-mono">{MONTHS_SHORT[r.month]}</div>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Right: Quick links + this month */}
          <div className="lg:col-span-4 border-r border-b border-slate-300 lg:border-l-0 border-l overflow-hidden">
            {/* Quick links */}
            <div className="bg-slate-200 border-b border-slate-300 px-3 py-1.5">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">HR Modules</span>
            </div>
            <div className="bg-white grid grid-cols-2 gap-px bg-slate-200">
              {[
                { to: '/hr/employees', label: 'Employees', count: employees.length },
                { to: '/hr/pay-today', label: 'Pay Today', count: null, accent: 'text-emerald-700' },
                { to: '/hr/payroll', label: 'Payroll Runs', count: sortedRuns.length },
                { to: '/hr/salary-structure', label: 'Salary Setup', count: null },
                { to: '/hr/designations', label: 'Designations', count: null },
                { to: '/hr/org-chart', label: 'Org Chart', count: null },
              ].map(m => (
                <Link key={m.to} to={m.to} className="bg-white px-3 py-3 hover:bg-slate-50 border-b border-slate-200">
                  <div className={`text-xs font-bold ${m.accent || 'text-slate-800'}`}>{m.label}</div>
                  {m.count !== null && <div className="text-[10px] text-slate-400 mt-0.5 font-mono">{m.count} records</div>}
                </Link>
              ))}
            </div>

            {/* Birthdays this month */}
            <div className="bg-slate-200 border-b border-t border-slate-300 px-3 py-1.5">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">🎂 Birthdays · {MONTHS[thisMonth]}</span>
            </div>
            <div className="bg-white">
              {upcomingBirthdays.length === 0 && <div className="px-3 py-3 text-[11px] text-slate-400 text-center">None this month</div>}
              {upcomingBirthdays.map((e) => (
                <div key={e.id} className="px-3 py-1.5 border-b border-slate-100 flex items-center gap-2 text-[11px]">
                  <span className="font-mono text-slate-500 text-[10px] w-12">{fmtDate(e.dateOfBirth)}</span>
                  <span className="font-medium text-slate-800">{e.firstName} {e.lastName}</span>
                  <span className="text-[10px] text-slate-400 ml-auto">{e.designation?.title || ''}</span>
                </div>
              ))}
            </div>

            {/* Work anniversaries this month */}
            <div className="bg-slate-200 border-b border-t border-slate-300 px-3 py-1.5">
              <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">🎉 Work Anniversaries · {MONTHS[thisMonth]}</span>
            </div>
            <div className="bg-white">
              {workAnniversaries.length === 0 && <div className="px-3 py-3 text-[11px] text-slate-400 text-center">None this month</div>}
              {workAnniversaries.map((e) => {
                const years = e.dateOfJoining ? today.getFullYear() - new Date(e.dateOfJoining).getFullYear() : 0;
                return (
                  <div key={e.id} className="px-3 py-1.5 border-b border-slate-100 flex items-center gap-2 text-[11px]">
                    <span className="font-mono text-slate-500 text-[10px] w-12">{fmtDate(e.dateOfJoining)}</span>
                    <span className="font-medium text-slate-800">{e.firstName} {e.lastName}</span>
                    <span className="text-[10px] text-emerald-600 font-bold ml-auto">{years} {years === 1 ? 'yr' : 'yrs'}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
