import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Employee {
  id: string;
  empCode?: string;
  employeeCode?: string;
  firstName?: string;
  lastName?: string;
  name?: string;
  department?: { name: string };
  designation?: { title: string };
  division?: string;
  cashPayPercent?: number;
  epfApplicable: boolean;
  esiApplicable: boolean;
}

interface CtcBreakdown {
  ctcAnnual: number;
  basicMonthly: number; basicAnnual: number;
  hraMonthly: number; hraAnnual: number;
  daMonthly: number; daAnnual: number;
  specialMonthly: number; specialAnnual: number;
  grossMonthly: number; grossAnnual: number;
  epfEmployerMonthly: number;
  esiEmployerMonthly: number;
  gratuityMonthly: number;
  edliMonthly: number;
  epfAdminMonthly: number;
  totalEmployerMonthly: number;
  epfEmployeeMonthly: number;
  esiEmployeeMonthly: number;
  ptMonthly: number;
  totalDeductionsMonthly: number;
  netMonthly: number;
}

interface SalaryData {
  employee: Employee & { ctcAnnual: number; basicMonthly: number };
  components: any[];
  breakdown: CtcBreakdown | null;
}

const DIVISIONS = ['SUGAR', 'POWER', 'ETHANOL', 'HQ', 'COMMON'];
const DIVISION_BADGE: Record<string, string> = {
  SUGAR: 'border-orange-400 bg-orange-50 text-orange-700',
  POWER: 'border-yellow-400 bg-yellow-50 text-yellow-700',
  ETHANOL: 'border-emerald-400 bg-emerald-50 text-emerald-700',
  HQ: 'border-indigo-400 bg-indigo-50 text-indigo-700',
  COMMON: 'border-slate-400 bg-slate-50 text-slate-700',
};

const empName = (e: Employee | undefined | null): string => {
  if (!e) return '';
  if (e.name) return e.name;
  return `${e.firstName || ''} ${e.lastName || ''}`.trim();
};
const empCode = (e: Employee | undefined | null): string => e?.empCode || e?.employeeCode || '';

const fmtINR = (n: number): string => {
  if (!n) return '\u20B9 0';
  return '\u20B9' + n.toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
const fmtNum = (n: number) => n ? n.toLocaleString('en-IN', { maximumFractionDigits: 0 }) : '0';

export default function SalaryStructure() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
  const [salaryData, setSalaryData] = useState<SalaryData | null>(null);
  const [ctcInput, setCtcInput] = useState('');
  const [cashPctInput, setCashPctInput] = useState('0');
  const [divisionInput, setDivisionInput] = useState('ETHANOL');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    api.get('/employees?isActive=true').then(res => setEmployees(res.data.employees || res.data)).catch(console.error);
  }, []);

  const loadSalary = useCallback(async (empId: string) => {
    if (!empId) { setSalaryData(null); return; }
    setLoading(true);
    try {
      const res = await api.get<SalaryData>(`/employee-salary/${empId}`);
      setSalaryData(res.data);
      setCtcInput(String(res.data.employee?.ctcAnnual || ''));
    } catch { setSalaryData(null); setCtcInput(''); } finally { setLoading(false); }
  }, []);

  const handleSelect = (empId: string) => {
    setSelectedId(empId);
    const emp = employees.find(e => e.id === empId) || null;
    setSelectedEmployee(emp);
    setCashPctInput(String(emp?.cashPayPercent ?? 0));
    setDivisionInput(emp?.division || 'ETHANOL');
    loadSalary(empId);
  };

  const handleSaveCTC = async () => {
    if (!selectedId || !ctcInput) return;
    setSaving(true);
    try {
      await api.put(`/employee-salary/${selectedId}`, { ctcAnnual: Number(ctcInput) });
      await loadSalary(selectedId);
    } catch (err) { console.error(err); } finally { setSaving(false); }
  };

  const handleSaveEmployeeFields = async (field: string, value: any) => {
    if (!selectedEmployee) return;
    try {
      await api.put(`/employees/${selectedEmployee.id}`, { [field]: value });
      const updated = { ...selectedEmployee, [field]: value };
      setSelectedEmployee(updated);
      setEmployees(prev => prev.map(e => e.id === selectedEmployee.id ? updated : e));
    } catch (err: unknown) {
      alert(err.response?.data?.error || 'Failed to update');
    }
  };

  const filteredEmployees = employees.filter(e =>
    empName(e).toLowerCase().includes(searchTerm.toLowerCase()) ||
    empCode(e).toLowerCase().includes(searchTerm.toLowerCase())
  );

  const bd = salaryData?.breakdown;
  const cashPct = Number(cashPctInput || 0);
  const cashMonthly = bd ? Math.round(bd.netMonthly * cashPct / 100) : 0;
  const bankMonthly = bd ? bd.netMonthly - cashMonthly : 0;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Salary Structure</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Set CTC, Division, Cash/Bank Split per employee</span>
          </div>
        </div>

        {/* Employee selector + config bar */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
            <div className="md:col-span-5">
              <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Search & Select Employee</label>
              <input value={searchTerm} onChange={e => setSearchTerm(e.target.value)} placeholder="Type code or name..." className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 mb-1.5" />
              <select value={selectedId} onChange={e => handleSelect(e.target.value)} size={Math.min(filteredEmployees.length + 1, 6)} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">-- Select an employee --</option>
                {filteredEmployees.map(e => (
                  <option key={e.id} value={e.id}>{empCode(e)} · {empName(e)}{e.department ? ` (${e.department.name})` : ''}{e.division ? ` [${e.division}]` : ''}</option>
                ))}
              </select>
            </div>

            <div className="md:col-span-7 grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="md:col-span-2">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">CTC (Annual ₹)</label>
                <div className="flex gap-1">
                  <input type="number" value={ctcInput} onChange={e => setCtcInput(e.target.value)} placeholder="e.g. 600000" disabled={!selectedId}
                    className="flex-1 border border-slate-300 px-2.5 py-1.5 text-xs font-mono font-bold text-slate-800 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50" />
                  <button onClick={handleSaveCTC} disabled={!selectedId || saving || !ctcInput} className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50">{saving ? '...' : 'Save'}</button>
                </div>
                {ctcInput && Number(ctcInput) > 0 && <p className="text-[10px] text-slate-500 mt-0.5">{fmtINR(Number(ctcInput))} per year</p>}
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Division</label>
                <select value={divisionInput} onChange={e => { setDivisionInput(e.target.value); handleSaveEmployeeFields('division', e.target.value); }} disabled={!selectedId} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50">
                  {DIVISIONS.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Cash Pay %</label>
                <div className="flex gap-1">
                  <input type="number" min="0" max="100" value={cashPctInput} onChange={e => setCashPctInput(e.target.value)} disabled={!selectedId} className="flex-1 border border-slate-300 px-2.5 py-1.5 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:bg-slate-50" />
                  <button onClick={() => handleSaveEmployeeFields('cashPayPercent', Number(cashPctInput))} disabled={!selectedId} className="px-2 py-1.5 bg-amber-600 text-white text-[10px] font-bold uppercase tracking-widest hover:bg-amber-700 disabled:opacity-50">Save</button>
                </div>
                <p className="text-[10px] text-slate-500 mt-0.5">{cashPct}% cash · {100 - cashPct}% bank</p>
              </div>
            </div>
          </div>

          {/* EPF / ESI toggles */}
          {selectedEmployee && (
            <div className="flex gap-4 mt-3 pt-3 border-t border-slate-200">
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={selectedEmployee.epfApplicable} onChange={e => handleSaveEmployeeFields('epfApplicable', e.target.checked)} className="w-3.5 h-3.5" />
                <span className="font-bold uppercase tracking-widest text-[10px]">EPF Applicable</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-slate-700 cursor-pointer">
                <input type="checkbox" checked={selectedEmployee.esiApplicable} onChange={e => handleSaveEmployeeFields('esiApplicable', e.target.checked)} className="w-3.5 h-3.5" />
                <span className="font-bold uppercase tracking-widest text-[10px]">ESI Applicable</span>
              </label>
              {selectedEmployee.division && (
                <span className={`ml-auto text-[9px] font-bold uppercase px-1.5 py-0.5 border ${DIVISION_BADGE[selectedEmployee.division] || 'border-slate-300'}`}>{selectedEmployee.division}</span>
              )}
            </div>
          )}
        </div>

        {/* Loading / breakdown / empty state */}
        {loading && <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 px-3 py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading salary breakdown...</div>}

        {!loading && !selectedId && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white px-6 py-12 text-center">
            <div className="text-sm text-slate-400 uppercase tracking-widest mb-2">Select an employee above</div>
            <div className="text-[11px] text-slate-500">Set CTC, division, and the cash/bank split for payroll computation.</div>
          </div>
        )}

        {!loading && bd && (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-emerald-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Gross / Month</div>
                <div className="text-xl font-bold text-emerald-700 mt-1 font-mono tabular-nums">{fmtINR(bd.grossMonthly)}</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-red-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Deductions</div>
                <div className="text-xl font-bold text-red-700 mt-1 font-mono tabular-nums">{fmtINR(bd.totalDeductionsMonthly)}</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Net / Month</div>
                <div className="text-xl font-bold text-blue-700 mt-1 font-mono tabular-nums">{fmtINR(bd.netMonthly)}</div>
                <div className="text-[9px] text-slate-400 mt-0.5">cash {fmtINR(cashMonthly)} · bank {fmtINR(bankMonthly)}</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-purple-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Employer Cost</div>
                <div className="text-xl font-bold text-purple-700 mt-1 font-mono tabular-nums">{fmtINR(bd.totalEmployerMonthly)}</div>
                <div className="text-[9px] text-slate-400 mt-0.5">EPF + ESI + EDLI + admin + gratuity</div>
              </div>
              <div className="bg-white px-4 py-3 border-l-4 border-l-indigo-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">CTC (Annual)</div>
                <div className="text-xl font-bold text-indigo-700 mt-1 font-mono tabular-nums">{fmtINR(bd.ctcAnnual)}</div>
              </div>
            </div>

            {/* 3-column tables: Earnings | Deductions | Employer */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-0 -mx-3 md:-mx-6">
              {/* Earnings */}
              <div className="border-x border-b border-slate-300 overflow-hidden">
                <div className="bg-emerald-100 border-b border-emerald-300 px-3 py-1.5">
                  <span className="text-[10px] font-bold text-emerald-800 uppercase tracking-widest">Earnings</span>
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-700 text-white">
                    <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Component</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Monthly</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Annual</th>
                  </tr></thead>
                  <tbody>
                    {[
                      { label: 'Basic', m: bd.basicMonthly, a: bd.basicAnnual },
                      { label: 'HRA', m: bd.hraMonthly, a: bd.hraAnnual },
                      { label: 'DA', m: bd.daMonthly, a: bd.daAnnual },
                      { label: 'Special Allowance', m: bd.specialMonthly, a: bd.specialAnnual },
                    ].map(r => (
                      <tr key={r.label} className="border-b border-slate-100 even:bg-slate-50/70">
                        <td className="px-3 py-1 text-slate-700 border-r border-slate-100">{r.label}</td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums border-r border-slate-100">{fmtNum(r.m)}</td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums">{fmtNum(r.a)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="bg-emerald-100 font-bold">
                    <td className="px-3 py-1.5 text-emerald-800 border-r border-slate-100">Gross</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-emerald-800 border-r border-slate-100">{fmtNum(bd.grossMonthly)}</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-emerald-800">{fmtNum(bd.grossAnnual)}</td>
                  </tr></tfoot>
                </table>
              </div>

              {/* Deductions */}
              <div className="border-r border-b border-slate-300 overflow-hidden md:border-l-0 border-l">
                <div className="bg-red-100 border-b border-red-300 px-3 py-1.5">
                  <span className="text-[10px] font-bold text-red-800 uppercase tracking-widest">Employee Deductions</span>
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-700 text-white">
                    <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Component</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Monthly</th>
                  </tr></thead>
                  <tbody>
                    {[
                      { label: 'EPF Employee (12%)', m: bd.epfEmployeeMonthly },
                      { label: 'ESI Employee (0.75%)', m: bd.esiEmployeeMonthly },
                      { label: 'Professional Tax', m: bd.ptMonthly },
                    ].map(r => (
                      <tr key={r.label} className="border-b border-slate-100 even:bg-slate-50/70">
                        <td className="px-3 py-1 text-slate-700 border-r border-slate-100">{r.label}</td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums">{fmtNum(r.m)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="bg-red-100 font-bold">
                    <td className="px-3 py-1.5 text-red-800 border-r border-slate-100">Total Deductions</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-red-800">{fmtNum(bd.totalDeductionsMonthly)}</td>
                  </tr></tfoot>
                </table>
                <div className="bg-slate-50 border-t border-slate-200 px-3 py-2">
                  <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Net Pay Disbursement</div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-amber-50 border border-amber-300 px-2 py-1">
                      <div className="text-[9px] font-bold text-amber-700 uppercase">Cash ({cashPct}%)</div>
                      <div className="font-mono font-bold text-amber-800">{fmtINR(cashMonthly)}</div>
                    </div>
                    <div className="bg-indigo-50 border border-indigo-300 px-2 py-1">
                      <div className="text-[9px] font-bold text-indigo-700 uppercase">Bank ({100 - cashPct}%)</div>
                      <div className="font-mono font-bold text-indigo-800">{fmtINR(bankMonthly)}</div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Employer Cost */}
              <div className="border-r border-b border-slate-300 overflow-hidden md:border-l-0 border-l">
                <div className="bg-purple-100 border-b border-purple-300 px-3 py-1.5">
                  <span className="text-[10px] font-bold text-purple-800 uppercase tracking-widest">Employer Contributions</span>
                </div>
                <table className="w-full text-xs">
                  <thead><tr className="bg-slate-700 text-white">
                    <th className="text-left px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-600">Component</th>
                    <th className="text-right px-3 py-1.5 font-semibold text-[10px] uppercase tracking-widest">Monthly</th>
                  </tr></thead>
                  <tbody>
                    {[
                      { label: 'EPF Employer (12%)', m: bd.epfEmployerMonthly },
                      { label: 'ESI Employer (3.25%)', m: bd.esiEmployerMonthly },
                      { label: 'EDLI', m: bd.edliMonthly },
                      { label: 'EPF Admin', m: bd.epfAdminMonthly },
                      { label: 'Gratuity', m: bd.gratuityMonthly },
                    ].map(r => (
                      <tr key={r.label} className="border-b border-slate-100 even:bg-slate-50/70">
                        <td className="px-3 py-1 text-slate-700 border-r border-slate-100">{r.label}</td>
                        <td className="px-3 py-1 text-right font-mono tabular-nums">{fmtNum(r.m)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot><tr className="bg-purple-100 font-bold">
                    <td className="px-3 py-1.5 text-purple-800 border-r border-slate-100">Total Employer</td>
                    <td className="px-3 py-1.5 text-right font-mono tabular-nums text-purple-800">{fmtNum(bd.totalEmployerMonthly)}</td>
                  </tr></tfoot>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
