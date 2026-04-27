import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface Employee {
  id: string;
  empCode: string;
  name: string;
  pan: string | null;
  panMissing: boolean;
  taxRegime: string;
  annualGross: number;
  monthlyTds: number;
  annualTax: number;
}

interface Form16Data {
  fyCode: string;
  employee: any;
  employer: any;
  monthly: { month: number; year: number; gross: number; epf: number; esi: number; pt: number; tds: number; net: number }[];
  earnings: { grossSalary: number };
  deductions: { epfEmployee: number; esiEmployee: number; professionalTax: number; tds: number };
  taxComputation: any;
  finalTaxLiability: number;
  refundOrPayable: number;
}

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmtINR = (n: number): string => '₹' + (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

function fyCodeFromDate(d: Date): string {
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

export default function Form16() {
  const now = new Date();
  // Default to *previous* FY since Form 16 is issued after FY ends
  const defaultFy = (() => {
    const m = now.getMonth() + 1;
    const y = now.getFullYear();
    const start = m >= 4 ? y - 1 : y - 2;
    return `${start}-${String(start + 1).slice(-2)}`;
  })();

  const [fyCode, setFyCode] = useState(defaultFy);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [selectedEmpId, setSelectedEmpId] = useState<string | null>(null);
  const [form16, setForm16] = useState<Form16Data | null>(null);
  const [form16Loading, setForm16Loading] = useState(false);

  const loadEmployees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/hr/tds/declarations', { params: search ? { search } : {} });
      setEmployees(res.data.employees || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);

  const loadForm16 = async (empId: string) => {
    setSelectedEmpId(empId);
    setForm16(null);
    setForm16Loading(true);
    try {
      const res = await api.get(`/hr/tds/form16/${empId}`, { params: { fy: fyCode } });
      setForm16(res.data);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Failed to load Form 16 data');
    } finally {
      setForm16Loading(false);
    }
  };

  const printForm16 = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0 print:p-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between flex-wrap gap-3 print:hidden">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Form 16 · Part B</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Annual TDS certificate · Section 203 · Issue to employees by 15 June</span>
          </div>
          <div className="text-[10px] text-slate-400">Annual TDS certificate · issue to employees by 15 June</div>
        </div>

        <div className="grid grid-cols-12 gap-0 print:block">
          {/* Sidebar — employee list */}
          <div className="col-span-12 md:col-span-4 lg:col-span-3 bg-white border-x border-b border-slate-300 -mx-3 md:-ml-6 md:mr-0 print:hidden">
            <div className="bg-slate-100 border-b border-slate-300 px-3 py-2 space-y-2">
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Fiscal Year</label>
                <select value={fyCode} onChange={e => { setFyCode(e.target.value); setForm16(null); setSelectedEmpId(null); }} className="w-full border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                  {[-2, -1, 0].map(d => {
                    const startY = now.getFullYear() + d - (now.getMonth() < 3 ? 1 : 0);
                    const code = `${startY}-${String(startY + 1).slice(-2)}`;
                    return <option key={code} value={code}>{code}</option>;
                  })}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Search Employee</label>
                <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Code / name / PAN" className="w-full border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100vh - 250px)' }}>
              {loading ? (
                <div className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
              ) : employees.length === 0 ? (
                <div className="px-3 py-6 text-center text-xs text-slate-400">No employees</div>
              ) : (
                employees.map(e => (
                  <button key={e.id} onClick={() => loadForm16(e.id)} className={`w-full text-left px-3 py-1.5 text-xs border-b border-slate-100 hover:bg-blue-50 ${selectedEmpId === e.id ? 'bg-blue-100 border-l-2 border-l-blue-600' : ''}`}>
                    <div className="font-medium">{e.name}</div>
                    <div className="text-[10px] text-slate-500 font-mono flex justify-between">
                      <span>{e.empCode}</span>
                      {e.panMissing ? <span className="text-red-700 font-bold">NO PAN</span> : <span>{e.pan}</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          {/* Main panel — Form 16 preview */}
          <div className="col-span-12 md:col-span-8 lg:col-span-9 bg-white border-x border-b border-slate-300 -mx-3 md:mx-0 md:mr-[-1.5rem] print:m-0 print:border-0">
            {!selectedEmpId ? (
              <div className="px-6 py-16 text-center text-slate-400">
                <div className="text-sm uppercase tracking-widest font-bold mb-1">Select an Employee</div>
                <div className="text-xs">Pick an employee from the left panel to generate Form 16 Part B for FY {fyCode}.</div>
              </div>
            ) : form16Loading ? (
              <div className="px-6 py-16 text-center text-xs text-slate-400 uppercase tracking-widest">Generating Form 16…</div>
            ) : !form16 ? (
              <div className="px-6 py-16 text-center text-slate-400 text-xs">No data — payroll may not have been computed for this FY.</div>
            ) : (
              <>
                {/* Action bar */}
                <div className="bg-slate-100 border-b border-slate-300 px-3 py-1.5 flex justify-end gap-2 print:hidden">
                  <button onClick={printForm16} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700">Print / PDF</button>
                </div>

                <div className="p-6 print:p-4">
                  {/* Header */}
                  <div className="text-center pb-4 border-b-2 border-slate-800 mb-4">
                    <div className="text-[10px] tracking-widest text-slate-500">FORM No. 16 — PART B</div>
                    <div className="text-base font-bold mt-1">Certificate under Section 203 of the Income-tax Act, 1961</div>
                    <div className="text-[10px] text-slate-500">For tax deducted at source on Salary — FY {form16.fyCode}</div>
                  </div>

                  {/* Employer / Employee info */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="border border-slate-300 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Employer (Deductor)</div>
                      <div className="text-xs font-bold">{form16.employer.name}</div>
                      <div className="text-[11px] text-slate-600">{form16.employer.address}</div>
                      <div className="text-[11px] mt-1"><span className="text-slate-500">PAN:</span> <span className="font-mono">{form16.employer.pan}</span></div>
                      <div className="text-[11px]"><span className="text-slate-500">TAN:</span> <span className="font-mono">{form16.employer.tan}</span></div>
                      <div className="text-[11px]"><span className="text-slate-500">CIN:</span> <span className="font-mono">{form16.employer.cin}</span></div>
                    </div>
                    <div className="border border-slate-300 p-3">
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-1">Employee (Deductee)</div>
                      <div className="text-xs font-bold">{form16.employee.name}</div>
                      <div className="text-[11px]"><span className="text-slate-500">Emp Code:</span> <span className="font-mono">{form16.employee.empCode}</span></div>
                      <div className="text-[11px]"><span className="text-slate-500">PAN:</span> {form16.employee.panMissing ? <span className="font-bold text-red-700">PANNOTAVBL</span> : <span className="font-mono">{form16.employee.pan}</span>}</div>
                      <div className="text-[11px]"><span className="text-slate-500">Designation:</span> {form16.employee.designation || '—'} · {form16.employee.department || '—'}</div>
                      <div className="text-[11px]"><span className="text-slate-500">Tax Regime:</span> <span className="font-bold">{form16.employee.taxRegime}</span></div>
                    </div>
                  </div>

                  {/* Monthly breakdown */}
                  <div className="mb-4">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-slate-700 mb-1">Monthly Salary Paid &amp; TDS Deducted</div>
                    <table className="w-full text-[11px] border border-slate-300">
                      <thead><tr className="bg-slate-100 border-b border-slate-300">
                        {['Month', 'Gross Salary', 'EPF', 'ESI', 'PT', 'TDS', 'Net Pay'].map(h => (
                          <th key={h} className="px-2 py-1 text-left font-semibold text-[10px] uppercase tracking-widest border-r border-slate-200 last:border-r-0 last:text-right">{h}</th>
                        ))}
                      </tr></thead>
                      <tbody>
                        {form16.monthly.map((m, i) => (
                          <tr key={i} className="border-b border-slate-100">
                            <td className="px-2 py-0.5 font-medium border-r border-slate-100">{MONTHS[m.month]} {String(m.year).slice(-2)}</td>
                            <td className="px-2 py-0.5 text-right font-mono border-r border-slate-100">{fmtINR(m.gross)}</td>
                            <td className="px-2 py-0.5 text-right font-mono border-r border-slate-100">{fmtINR(m.epf)}</td>
                            <td className="px-2 py-0.5 text-right font-mono border-r border-slate-100">{fmtINR(m.esi)}</td>
                            <td className="px-2 py-0.5 text-right font-mono border-r border-slate-100">{fmtINR(m.pt)}</td>
                            <td className="px-2 py-0.5 text-right font-mono text-red-700 border-r border-slate-100">{fmtINR(m.tds)}</td>
                            <td className="px-2 py-0.5 text-right font-mono">{fmtINR(m.net)}</td>
                          </tr>
                        ))}
                        <tr className="bg-slate-100 font-bold border-t-2 border-slate-400">
                          <td className="px-2 py-1 uppercase text-[10px] tracking-widest border-r border-slate-200">Total</td>
                          <td className="px-2 py-1 text-right font-mono border-r border-slate-200">{fmtINR(form16.earnings.grossSalary)}</td>
                          <td className="px-2 py-1 text-right font-mono border-r border-slate-200">{fmtINR(form16.deductions.epfEmployee)}</td>
                          <td className="px-2 py-1 text-right font-mono border-r border-slate-200">{fmtINR(form16.deductions.esiEmployee)}</td>
                          <td className="px-2 py-1 text-right font-mono border-r border-slate-200">{fmtINR(form16.deductions.professionalTax)}</td>
                          <td className="px-2 py-1 text-right font-mono text-red-700 border-r border-slate-200">{fmtINR(form16.deductions.tds)}</td>
                          <td className="px-2 py-1 text-right font-mono">{fmtINR(form16.earnings.grossSalary - form16.deductions.epfEmployee - form16.deductions.esiEmployee - form16.deductions.professionalTax - form16.deductions.tds)}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  {/* Tax computation */}
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-700 mb-1">Computation of Total Income &amp; Tax</div>
                      <table className="w-full text-[11px] border border-slate-300">
                        <tbody>
                          <tr className="border-b border-slate-100"><td className="px-2 py-0.5 text-slate-500">Gross Salary</td><td className="px-2 py-0.5 text-right font-mono">{fmtINR(form16.taxComputation.annualGross)}</td></tr>
                          <tr className="border-b border-slate-100"><td className="px-2 py-0.5 text-slate-500">Less: Standard Deduction</td><td className="px-2 py-0.5 text-right font-mono">{fmtINR(form16.taxComputation.standardDeduction)}</td></tr>
                          {form16.taxComputation.regime === 'OLD' && (
                            <>
                              <tr className="border-b border-slate-100"><td className="px-2 py-0.5 text-slate-500">Less: Section 80C</td><td className="px-2 py-0.5 text-right font-mono">{fmtINR(form16.taxComputation.section80C)}</td></tr>
                              <tr className="border-b border-slate-100"><td className="px-2 py-0.5 text-slate-500">Less: Section 80D</td><td className="px-2 py-0.5 text-right font-mono">{fmtINR(form16.taxComputation.section80D)}</td></tr>
                              <tr className="border-b border-slate-100"><td className="px-2 py-0.5 text-slate-500">Less: Other deductions</td><td className="px-2 py-0.5 text-right font-mono">{fmtINR(form16.taxComputation.otherDeductions)}</td></tr>
                            </>
                          )}
                          <tr className="bg-slate-50 border-b border-slate-300 font-medium"><td className="px-2 py-1">Taxable Income</td><td className="px-2 py-1 text-right font-mono">{fmtINR(form16.taxComputation.taxableIncome)}</td></tr>
                          <tr className="border-b border-slate-100"><td className="px-2 py-0.5 text-slate-500">Tax on income (slab)</td><td className="px-2 py-0.5 text-right font-mono">{fmtINR(form16.taxComputation.taxBeforeRebate)}</td></tr>
                          <tr className="border-b border-slate-100"><td className="px-2 py-0.5 text-slate-500">Less: Rebate u/s 87A</td><td className="px-2 py-0.5 text-right font-mono text-emerald-700">{fmtINR(form16.taxComputation.rebate87A)}</td></tr>
                          <tr className="border-b border-slate-100"><td className="px-2 py-0.5 text-slate-500">Add: Cess @ 4%</td><td className="px-2 py-0.5 text-right font-mono">{fmtINR(form16.taxComputation.cess)}</td></tr>
                          <tr className="bg-slate-100 font-bold"><td className="px-2 py-1">Total Tax Payable</td><td className="px-2 py-1 text-right font-mono text-red-700">{fmtINR(form16.taxComputation.annualTax)}</td></tr>
                        </tbody>
                      </table>
                    </div>
                    <div>
                      <div className="text-[10px] font-bold uppercase tracking-widest text-slate-700 mb-1">Final Settlement</div>
                      <table className="w-full text-[11px] border border-slate-300">
                        <tbody>
                          <tr className="border-b border-slate-100"><td className="px-2 py-0.5 text-slate-500">Total Tax Liability</td><td className="px-2 py-0.5 text-right font-mono">{fmtINR(form16.finalTaxLiability)}</td></tr>
                          <tr className="border-b border-slate-100"><td className="px-2 py-0.5 text-slate-500">TDS Deducted (this FY)</td><td className="px-2 py-0.5 text-right font-mono">{fmtINR(form16.deductions.tds)}</td></tr>
                          <tr className="bg-slate-100 font-bold border-t-2 border-slate-400">
                            <td className="px-2 py-1">{form16.refundOrPayable >= 0 ? 'Refund Due to Employee' : 'Tax Still Payable'}</td>
                            <td className={`px-2 py-1 text-right font-mono ${form16.refundOrPayable >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fmtINR(Math.abs(form16.refundOrPayable))}</td>
                          </tr>
                        </tbody>
                      </table>

                      <div className="mt-4 text-[10px] text-slate-600 border border-slate-200 bg-slate-50 p-2">
                        <strong>Verification:</strong> I, the responsible person, certify that the information given above is true, complete and correct, and is based on books of account, documents, TDS statements, and other available records.
                      </div>

                      <div className="mt-8 grid grid-cols-2 gap-3 text-[10px]">
                        <div className="border-t border-slate-300 pt-1">
                          <div className="text-slate-500">Place: Narsinghpur, MP</div>
                          <div className="text-slate-500">Date: {new Date().toLocaleDateString('en-IN')}</div>
                        </div>
                        <div className="border-t border-slate-300 pt-1 text-right">
                          <div className="font-bold">Authorised Signatory</div>
                          <div className="text-slate-500">For {form16.employer.name}</div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="text-[9px] text-slate-400 mt-4 print:hidden">
                    Note: This is the Part B summary only. Part A (TRACES download) must be issued separately. Form 16 is statutorily required to be issued by 15 June following the FY.
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
