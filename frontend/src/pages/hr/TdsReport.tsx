import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface RegisterLine {
  id: string;
  empCode: string;
  name: string;
  pan: string | null;
  panMissing: boolean;
  division: string;
  department: string | null;
  designation: string | null;
  regime: string;
  gross: number;
  tds: number;
  section: string;
}

interface Form24QDeductee {
  employeeId: string;
  empCode: string;
  name: string;
  pan: string;
  regime: string;
  section: string;
  gross: number;
  tds: number;
  months: { month: number; year: number; tds: number }[];
}

interface Challan {
  id: string;
  fyCode: string;
  quarter: number;
  month: number;
  year: number;
  section: string;
  challanNo: string;
  bsrCode: string;
  depositDate: string;
  amount: number;
  taxAmount: number;
  cess: number;
  interest: number;
  paymentMode: string;
  bankName: string | null;
  filedInForm24Q: boolean;
}

interface SummaryQuarter {
  quarter: number;
  deducted: number;
  deposited: number;
  gap: number;
}

const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MONTHS_SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const fmtINR = (n: number): string => '₹' + (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const fmtDate = (s: string): string => new Date(s).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });

const REGIME_BADGE: Record<string, string> = {
  NEW: 'border-blue-400 bg-blue-50 text-blue-700',
  OLD: 'border-amber-400 bg-amber-50 text-amber-700',
};

function fyCodeFromDate(d: Date): string {
  const month = d.getMonth() + 1;
  const year = d.getFullYear();
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

type Tab = 'register' | '24q' | 'challans';

export default function TdsReport() {
  const [tab, setTab] = useState<Tab>('register');

  // Period
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [fyCode, setFyCode] = useState(fyCodeFromDate(now));
  const [quarter, setQuarter] = useState(1);

  // Register
  const [register, setRegister] = useState<RegisterLine[]>([]);
  const [registerTotals, setRegisterTotals] = useState<any>(null);
  const [registerRun, setRegisterRun] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  // Form 24Q
  const [form24q, setForm24q] = useState<{ deductees: Form24QDeductee[]; challans: Challan[]; totals: any; runs: any[] } | null>(null);

  // Challans
  const [challans, setChallans] = useState<Challan[]>([]);
  const [challanTotals, setChallanTotals] = useState<any>(null);
  const [showChallanForm, setShowChallanForm] = useState(false);
  const [editChallanId, setEditChallanId] = useState<string | null>(null);
  const [challanForm, setChallanForm] = useState({
    fyCode: fyCode, quarter: 1, month: now.getMonth() + 1, year: now.getFullYear(), section: '192',
    challanNo: '', bsrCode: '', depositDate: now.toISOString().slice(0, 10),
    amount: '', taxAmount: '', surcharge: '0', cess: '0', interest: '0', penalty: '0', others: '0',
    paymentMode: 'ONLINE', bankName: '', remarks: '',
  });
  const [savingChallan, setSavingChallan] = useState(false);

  // Summary
  const [summary, setSummary] = useState<{ byQuarter: SummaryQuarter[]; totals: any } | null>(null);

  const loadRegister = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/hr/tds/register', { params: { month, year } });
      setRegister(res.data.lines || []);
      setRegisterTotals(res.data.totals);
      setRegisterRun(res.data.run);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  const load24Q = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/hr/tds/24q', { params: { fy: fyCode, quarter } });
      setForm24q(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [fyCode, quarter]);

  const loadChallans = useCallback(async () => {
    setLoading(true);
    try {
      const [c, s] = await Promise.all([
        api.get('/hr/tds/challans', { params: { fy: fyCode } }),
        api.get('/hr/tds/summary', { params: { fy: fyCode } }),
      ]);
      setChallans(c.data.challans || []);
      setChallanTotals(c.data.totals);
      setSummary(s.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [fyCode]);

  useEffect(() => {
    if (tab === 'register') loadRegister();
    else if (tab === '24q') load24Q();
    else if (tab === 'challans') loadChallans();
  }, [tab, loadRegister, load24Q, loadChallans]);

  const downloadCsv = () => {
    const url = `/api/hr/tds/24q?fy=${fyCode}&quarter=${quarter}&format=csv`;
    window.open(url, '_blank');
  };

  const openNewChallan = () => {
    setEditChallanId(null);
    setChallanForm({
      fyCode: fyCode,
      quarter: quarterFromMonth(now.getMonth() + 1),
      month: now.getMonth() + 1,
      year: now.getFullYear(),
      section: '192',
      challanNo: '', bsrCode: '', depositDate: now.toISOString().slice(0, 10),
      amount: '', taxAmount: '', surcharge: '0', cess: '0', interest: '0', penalty: '0', others: '0',
      paymentMode: 'ONLINE', bankName: '', remarks: '',
    });
    setShowChallanForm(true);
  };

  const openEditChallan = (c: Challan) => {
    setEditChallanId(c.id);
    setChallanForm({
      fyCode: c.fyCode, quarter: c.quarter, month: c.month, year: c.year, section: c.section,
      challanNo: c.challanNo, bsrCode: c.bsrCode, depositDate: c.depositDate.slice(0, 10),
      amount: String(c.amount), taxAmount: String(c.taxAmount),
      surcharge: '0', cess: String(c.cess), interest: String(c.interest), penalty: '0', others: '0',
      paymentMode: c.paymentMode, bankName: c.bankName || '', remarks: '',
    });
    setShowChallanForm(true);
  };

  const saveChallan = async () => {
    setSavingChallan(true);
    try {
      const payload = {
        ...challanForm,
        quarter: Number(challanForm.quarter),
        month: Number(challanForm.month),
        year: Number(challanForm.year),
        amount: Number(challanForm.amount),
        taxAmount: Number(challanForm.taxAmount || challanForm.amount),
        surcharge: Number(challanForm.surcharge),
        cess: Number(challanForm.cess),
        interest: Number(challanForm.interest),
        penalty: Number(challanForm.penalty),
        others: Number(challanForm.others),
      };
      if (editChallanId) await api.put(`/hr/tds/challans/${editChallanId}`, payload);
      else await api.post('/hr/tds/challans', payload);
      setShowChallanForm(false);
      await loadChallans();
    } catch (err: unknown) {
      alert(err.response?.data?.error || JSON.stringify(err.response?.data?.details) || 'Save failed');
    } finally {
      setSavingChallan(false);
    }
  };

  const deleteChallan = async (id: string) => {
    if (!confirm('Delete this challan? This cannot be undone.')) return;
    try {
      await api.delete(`/hr/tds/challans/${id}`);
      await loadChallans();
    } catch (err) {
      alert('Delete failed');
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">TDS Report · Section 192</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Monthly register · Form 24Q quarterly · ITNS-281 challan tracking</span>
          </div>
          <div className="text-[10px] text-slate-400">Section 192 · monthly register / Form 24Q / ITNS-281 challans</div>
        </div>

        {/* Tabs */}
        <div className="bg-slate-100 border-x border-b border-slate-300 -mx-3 md:-mx-6 flex">
          {[
            { key: 'register' as Tab, label: 'Monthly Register' },
            { key: '24q' as Tab, label: 'Form 24Q (Quarterly)' },
            { key: 'challans' as Tab, label: 'Challans (ITNS-281)' },
          ].map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-r border-slate-300 ${tab === t.key ? 'bg-white text-slate-800 border-b-2 border-b-blue-600' : 'text-slate-500 hover:bg-slate-50'}`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Period selector */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-end gap-3 flex-wrap">
          {tab === 'register' && (
            <>
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
            </>
          )}
          {(tab === '24q' || tab === 'challans') && (
            <>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Fiscal Year</label>
                <select value={fyCode} onChange={e => setFyCode(e.target.value)} className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                  {[-1, 0, 1].map(d => {
                    const startY = now.getFullYear() + d - (now.getMonth() < 3 ? 1 : 0);
                    const code = `${startY}-${String(startY + 1).slice(-2)}`;
                    return <option key={code} value={code}>{code}</option>;
                  })}
                </select>
              </div>
              {tab === '24q' && (
                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Quarter</label>
                  <select value={quarter} onChange={e => setQuarter(Number(e.target.value))} className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                    <option value={1}>Q1 (Apr–Jun)</option>
                    <option value={2}>Q2 (Jul–Sep)</option>
                    <option value={3}>Q3 (Oct–Dec)</option>
                    <option value={4}>Q4 (Jan–Mar)</option>
                  </select>
                </div>
              )}
            </>
          )}
          <div className="ml-auto flex gap-2">
            {tab === '24q' && form24q && form24q.deductees.length > 0 && (
              <button onClick={downloadCsv} className="px-3 py-1.5 border border-slate-400 bg-white text-slate-700 text-[11px] font-bold uppercase tracking-widest hover:bg-slate-50">↓ Form 24Q CSV</button>
            )}
            {tab === 'challans' && (
              <button onClick={openNewChallan} className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700">+ Record Challan</button>
            )}
          </div>
        </div>

        {/* Tab Content */}
        {tab === 'register' && (
          <RegisterTab loading={loading} register={register} totals={registerTotals} run={registerRun} month={month} year={year} />
        )}
        {tab === '24q' && (
          <Form24QTab loading={loading} data={form24q} fyCode={fyCode} quarter={quarter} />
        )}
        {tab === 'challans' && (
          <ChallansTab loading={loading} challans={challans} totals={challanTotals} summary={summary} fyCode={fyCode}
            onEdit={openEditChallan} onDelete={deleteChallan} />
        )}

        {/* Challan form modal */}
        {showChallanForm && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white border border-slate-400 max-w-3xl w-full max-h-[90vh] overflow-y-auto">
              <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
                <h2 className="text-sm font-bold uppercase tracking-widest">{editChallanId ? 'Edit Challan' : 'Record TDS Challan (ITNS-281)'}</h2>
                <button onClick={() => setShowChallanForm(false)} className="text-slate-400 hover:text-white text-lg">×</button>
              </div>
              <div className="p-4 space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Fiscal Year">
                    <input type="text" value={challanForm.fyCode} onChange={e => setChallanForm({ ...challanForm, fyCode: e.target.value })} className={inputCls} placeholder="2026-27" />
                  </Field>
                  <Field label="Quarter">
                    <select value={challanForm.quarter} onChange={e => setChallanForm({ ...challanForm, quarter: Number(e.target.value) })} className={inputCls}>
                      <option value={1}>Q1 (Apr–Jun)</option>
                      <option value={2}>Q2 (Jul–Sep)</option>
                      <option value={3}>Q3 (Oct–Dec)</option>
                      <option value={4}>Q4 (Jan–Mar)</option>
                    </select>
                  </Field>
                  <Field label="Section">
                    <select value={challanForm.section} onChange={e => setChallanForm({ ...challanForm, section: e.target.value })} className={inputCls}>
                      <option value="192">192 — Salary</option>
                      <option value="192A">192A — PF withdrawal</option>
                    </select>
                  </Field>
                  <Field label="For Month">
                    <select value={challanForm.month} onChange={e => setChallanForm({ ...challanForm, month: Number(e.target.value) })} className={inputCls}>
                      {MONTHS.slice(1).map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                    </select>
                  </Field>
                  <Field label="For Year">
                    <input type="number" value={challanForm.year} onChange={e => setChallanForm({ ...challanForm, year: Number(e.target.value) })} className={inputCls} />
                  </Field>
                  <Field label="Deposit Date">
                    <input type="date" value={challanForm.depositDate} onChange={e => setChallanForm({ ...challanForm, depositDate: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="Challan No (CIN)">
                    <input type="text" value={challanForm.challanNo} onChange={e => setChallanForm({ ...challanForm, challanNo: e.target.value })} className={inputCls} placeholder="00012" />
                  </Field>
                  <Field label="BSR Code (7 digits)">
                    <input type="text" value={challanForm.bsrCode} onChange={e => setChallanForm({ ...challanForm, bsrCode: e.target.value })} maxLength={7} className={inputCls} placeholder="0510123" />
                  </Field>
                  <Field label="Payment Mode">
                    <select value={challanForm.paymentMode} onChange={e => setChallanForm({ ...challanForm, paymentMode: e.target.value })} className={inputCls}>
                      <option value="ONLINE">Online (Net banking)</option>
                      <option value="OTC_CHEQUE">OTC – Cheque</option>
                      <option value="OTC_CASH">OTC – Cash</option>
                    </select>
                  </Field>
                  <Field label="Tax Amount">
                    <input type="number" value={challanForm.taxAmount} onChange={e => setChallanForm({ ...challanForm, taxAmount: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="Cess (4%)">
                    <input type="number" value={challanForm.cess} onChange={e => setChallanForm({ ...challanForm, cess: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="Interest (if any)">
                    <input type="number" value={challanForm.interest} onChange={e => setChallanForm({ ...challanForm, interest: e.target.value })} className={inputCls} />
                  </Field>
                  <Field label="Total Amount">
                    <input type="number" value={challanForm.amount} onChange={e => setChallanForm({ ...challanForm, amount: e.target.value })} className={inputCls + ' font-bold'} />
                  </Field>
                  <Field label="Bank Name">
                    <input type="text" value={challanForm.bankName} onChange={e => setChallanForm({ ...challanForm, bankName: e.target.value })} className={inputCls} placeholder="UBI" />
                  </Field>
                  <Field label="Remarks">
                    <input type="text" value={challanForm.remarks} onChange={e => setChallanForm({ ...challanForm, remarks: e.target.value })} className={inputCls} />
                  </Field>
                </div>
                <div className="flex gap-2 pt-3 border-t border-slate-200">
                  <button onClick={saveChallan} disabled={savingChallan} className="px-4 py-1.5 bg-emerald-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50">{savingChallan ? 'Saving…' : (editChallanId ? 'Update' : 'Save Challan')}</button>
                  <button onClick={() => setShowChallanForm(false)} className="px-4 py-1.5 border border-slate-400 bg-white text-slate-700 text-[11px] font-bold uppercase tracking-widest hover:bg-slate-50">Cancel</button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const inputCls = 'w-full border border-slate-300 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">{label}</label>
      {children}
    </div>
  );
}

function quarterFromMonth(month: number): number {
  if (month >= 4 && month <= 6) return 1;
  if (month >= 7 && month <= 9) return 2;
  if (month >= 10 && month <= 12) return 3;
  return 4;
}

// ─────────────────────────────────────────────────────────
// Tab Components
// ─────────────────────────────────────────────────────────

function RegisterTab({ loading, register, totals, run, month, year }: any) {
  return (
    <>
      {totals && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-0 -mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white">
          {[
            { label: 'Period', value: `${MONTHS[month]} ${year}`, color: 'text-slate-800' },
            { label: 'Run Status', value: run?.status || 'NO RUN', color: 'text-slate-800' },
            { label: 'Employees w/ TDS', value: totals.employees, color: 'text-blue-700' },
            { label: 'PAN Missing', value: totals.panMissing, color: 'text-red-700' },
            { label: 'Total TDS', value: fmtINR(totals.tds), color: 'text-red-700' },
          ].map((c, i) => (
            <div key={i} className="px-4 py-2.5 border-r border-slate-200 last:border-r-0">
              <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{c.label}</div>
              <div className={`text-sm font-bold ${c.color}`}>{c.value}</div>
            </div>
          ))}
        </div>
      )}

      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
        {loading ? (
          <div className="px-3 py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading register...</div>
        ) : !run ? (
          <div className="px-3 py-12 text-center text-xs text-slate-400">No payroll run for {MONTHS[month]} {year}. Create &amp; compute it from <a href="/hr/payroll" className="text-blue-600 underline">Payroll</a>.</div>
        ) : register.length === 0 ? (
          <div className="px-3 py-12 text-center text-xs text-slate-400">No employees had TDS deducted in this run. (Likely all below taxable threshold or run not computed yet.)</div>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-800 text-white">
              {['Sl.', 'Emp #', 'Name', 'PAN', 'Section', 'Regime', 'Department', 'Gross Salary', 'TDS Deducted'].map(h => (
                <th key={h} className="px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left last:border-r-0 last:text-right">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {register.map((l: RegisterLine, i: number) => (
                <tr key={l.id} className={`border-b border-slate-100 hover:bg-blue-50/40 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{i + 1}</td>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{l.empCode}</td>
                  <td className="px-2 py-1 border-r border-slate-100">
                    <div className="font-medium">{l.name}</div>
                    <div className="text-[10px] text-slate-500">{l.designation || '—'}</div>
                  </td>
                  <td className="px-2 py-1 font-mono border-r border-slate-100">
                    {l.pan ? <span className="text-[10px]">{l.pan}</span> : <span className="text-[9px] font-bold text-red-700 bg-red-50 border border-red-300 px-1 py-0.5">MISSING</span>}
                  </td>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{l.section}</td>
                  <td className="px-2 py-1 border-r border-slate-100">
                    <span className={`text-[9px] font-bold uppercase px-1 py-0.5 border ${REGIME_BADGE[l.regime] || ''}`}>{l.regime}</span>
                  </td>
                  <td className="px-2 py-1 text-slate-500 border-r border-slate-100">{l.department || '—'}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums border-r border-slate-100">{fmtINR(l.gross)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums font-bold text-red-700">{fmtINR(l.tds)}</td>
                </tr>
              ))}
              {totals && (
                <tr className="bg-slate-100 font-bold border-t-2 border-slate-400">
                  <td colSpan={7} className="px-2 py-1.5 text-right text-[10px] uppercase tracking-widest">Total</td>
                  <td className="px-2 py-1.5 text-right font-mono">{fmtINR(totals.gross)}</td>
                  <td className="px-2 py-1.5 text-right font-mono text-red-700">{fmtINR(totals.tds)}</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function Form24QTab({ loading, data, fyCode, quarter }: any) {
  if (loading) return <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 px-3 py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading Form 24Q…</div>;
  if (!data) return null;

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-6 gap-0 -mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white">
        {[
          { label: 'FY · Quarter', value: `${fyCode} · Q${quarter}`, color: 'text-slate-800' },
          { label: 'Deductees', value: data.totals.employees, color: 'text-blue-700' },
          { label: 'PAN Missing', value: data.totals.panMissing, color: 'text-red-700' },
          { label: 'TDS Deducted', value: fmtINR(data.totals.tds), color: 'text-red-700' },
          { label: 'Deposited', value: fmtINR(data.totals.deposited), color: 'text-emerald-700' },
          { label: 'Gap', value: fmtINR(data.totals.gap), color: data.totals.gap > 0 ? 'text-red-700' : 'text-emerald-700' },
        ].map((c, i) => (
          <div key={i} className="px-4 py-2.5 border-r border-slate-200 last:border-r-0">
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{c.label}</div>
            <div className={`text-sm font-bold ${c.color}`}>{c.value}</div>
          </div>
        ))}
      </div>

      {/* Deductees */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
        <div className="bg-slate-700 text-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest">Annexure II — Deductee-wise breakdown</div>
        {data.deductees.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-400">No TDS deducted in {fyCode} Q{quarter}. Compute payroll for the months in this quarter.</div>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-100 text-slate-700 border-b border-slate-300">
              {['Sl.', 'PAN', 'Name', 'Emp #', 'Section', 'Regime', 'Gross Paid', 'TDS Deducted'].map(h => (
                <th key={h} className="px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-200 text-left last:border-r-0 last:text-right">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.deductees.map((d: Form24QDeductee, i: number) => (
                <tr key={d.employeeId} className={`border-b border-slate-100 hover:bg-blue-50/40 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{i + 1}</td>
                  <td className="px-2 py-1 font-mono border-r border-slate-100">
                    {d.pan === 'PANNOTAVBL' ? <span className="text-[9px] font-bold text-red-700 bg-red-50 border border-red-300 px-1 py-0.5">PANNOTAVBL</span> : <span className="text-[10px]">{d.pan}</span>}
                  </td>
                  <td className="px-2 py-1 font-medium border-r border-slate-100">{d.name}</td>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{d.empCode}</td>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{d.section}</td>
                  <td className="px-2 py-1 border-r border-slate-100">
                    <span className={`text-[9px] font-bold uppercase px-1 py-0.5 border ${REGIME_BADGE[d.regime] || ''}`}>{d.regime}</span>
                  </td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums border-r border-slate-100">{fmtINR(d.gross)}</td>
                  <td className="px-2 py-1 text-right font-mono tabular-nums font-bold text-red-700">{fmtINR(d.tds)}</td>
                </tr>
              ))}
              <tr className="bg-slate-100 font-bold border-t-2 border-slate-400">
                <td colSpan={6} className="px-2 py-1.5 text-right text-[10px] uppercase tracking-widest">Total</td>
                <td className="px-2 py-1.5 text-right font-mono">{fmtINR(data.totals.gross)}</td>
                <td className="px-2 py-1.5 text-right font-mono text-red-700">{fmtINR(data.totals.tds)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>

      {/* Challans */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
        <div className="bg-slate-700 text-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest flex items-center justify-between">
          <span>Annexure I — Challan deposits</span>
          <a href="/hr/tds-report?tab=challans" className="text-[10px] text-slate-300 hover:text-white normal-case tracking-normal">+ Add challan in Challans tab →</a>
        </div>
        {data.challans.length === 0 ? (
          <div className="px-3 py-8 text-center text-xs text-slate-400">No challans recorded for this quarter. Tax deducted but not yet deposited?</div>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-100 text-slate-700 border-b border-slate-300">
              {['Sl.', 'Challan No', 'BSR Code', 'Deposit Date', 'For Month', 'Tax', 'Cess', 'Interest', 'Total', 'Mode'].map(h => (
                <th key={h} className="px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-200 text-left last:border-r-0 last:text-right">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {data.challans.map((c: Challan, i: number) => (
                <tr key={c.id} className={`border-b border-slate-100 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{i + 1}</td>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{c.challanNo}</td>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{c.bsrCode}</td>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{fmtDate(c.depositDate)}</td>
                  <td className="px-2 py-1 text-[10px] border-r border-slate-100">{MONTHS_SHORT[c.month]} {c.year}</td>
                  <td className="px-2 py-1 text-right font-mono border-r border-slate-100">{fmtINR(c.taxAmount)}</td>
                  <td className="px-2 py-1 text-right font-mono border-r border-slate-100">{fmtINR(c.cess)}</td>
                  <td className="px-2 py-1 text-right font-mono border-r border-slate-100">{fmtINR(c.interest)}</td>
                  <td className="px-2 py-1 text-right font-mono font-bold text-emerald-700 border-r border-slate-100">{fmtINR(c.amount)}</td>
                  <td className="px-2 py-1 text-[10px] text-slate-500">{c.paymentMode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}

function ChallansTab({ loading, challans, totals, summary, fyCode, onEdit, onDelete }: any) {
  return (
    <>
      {/* FY summary by quarter */}
      {summary && (
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white">
          <div className="bg-slate-700 text-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest">FY {fyCode} — Quarterly Summary</div>
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-100 text-slate-700 border-b border-slate-200">
              <th className="px-3 py-1.5 text-left text-[10px] font-bold uppercase tracking-widest border-r border-slate-200">Quarter</th>
              <th className="px-3 py-1.5 text-right text-[10px] font-bold uppercase tracking-widest border-r border-slate-200">TDS Deducted (Payroll)</th>
              <th className="px-3 py-1.5 text-right text-[10px] font-bold uppercase tracking-widest border-r border-slate-200">Deposited (Challan)</th>
              <th className="px-3 py-1.5 text-right text-[10px] font-bold uppercase tracking-widest">Gap</th>
            </tr></thead>
            <tbody>
              {summary.byQuarter.map((q: SummaryQuarter) => (
                <tr key={q.quarter} className="border-b border-slate-100">
                  <td className="px-3 py-1.5 font-medium border-r border-slate-100">Q{q.quarter}</td>
                  <td className="px-3 py-1.5 text-right font-mono border-r border-slate-100">{fmtINR(q.deducted)}</td>
                  <td className="px-3 py-1.5 text-right font-mono text-emerald-700 border-r border-slate-100">{fmtINR(q.deposited)}</td>
                  <td className={`px-3 py-1.5 text-right font-mono ${q.gap > 0 ? 'text-red-700 font-bold' : 'text-emerald-700'}`}>{fmtINR(q.gap)}</td>
                </tr>
              ))}
              <tr className="bg-slate-100 font-bold border-t-2 border-slate-400">
                <td className="px-3 py-1.5 uppercase text-[10px] tracking-widest">FY Total</td>
                <td className="px-3 py-1.5 text-right font-mono">{fmtINR(summary.totals.deducted)}</td>
                <td className="px-3 py-1.5 text-right font-mono text-emerald-700">{fmtINR(summary.totals.deposited)}</td>
                <td className={`px-3 py-1.5 text-right font-mono ${summary.totals.gap > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{fmtINR(summary.totals.gap)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* Challans list */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto">
        <div className="bg-slate-700 text-white px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest flex items-center justify-between">
          <span>Challans ({totals?.count || 0}) · Total deposited: {fmtINR(totals?.amount || 0)}</span>
        </div>
        {loading ? (
          <div className="px-3 py-12 text-center text-xs text-slate-400 uppercase tracking-widest">Loading challans...</div>
        ) : challans.length === 0 ? (
          <div className="px-3 py-12 text-center text-xs text-slate-400">No challans recorded for FY {fyCode}. Click "+ Record Challan" above to add one after govt deposit.</div>
        ) : (
          <table className="w-full text-xs">
            <thead><tr className="bg-slate-100 text-slate-700 border-b border-slate-300">
              {['Quarter', 'Section', 'For Period', 'Challan No', 'BSR', 'Deposit Date', 'Tax', 'Cess', 'Total', 'Mode', 'Filed?', 'Actions'].map(h => (
                <th key={h} className="px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-200 text-left last:border-r-0 last:text-right">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {challans.map((c: Challan, i: number) => (
                <tr key={c.id} className={`border-b border-slate-100 hover:bg-blue-50/40 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">Q{c.quarter}</td>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{c.section}</td>
                  <td className="px-2 py-1 text-[10px] border-r border-slate-100">{MONTHS_SHORT[c.month]} {c.year}</td>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{c.challanNo}</td>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{c.bsrCode}</td>
                  <td className="px-2 py-1 font-mono text-[10px] border-r border-slate-100">{fmtDate(c.depositDate)}</td>
                  <td className="px-2 py-1 text-right font-mono border-r border-slate-100">{fmtINR(c.taxAmount)}</td>
                  <td className="px-2 py-1 text-right font-mono border-r border-slate-100">{fmtINR(c.cess)}</td>
                  <td className="px-2 py-1 text-right font-mono font-bold text-emerald-700 border-r border-slate-100">{fmtINR(c.amount)}</td>
                  <td className="px-2 py-1 text-[10px] border-r border-slate-100">{c.paymentMode}</td>
                  <td className="px-2 py-1 border-r border-slate-100">
                    {c.filedInForm24Q ? <span className="text-[9px] font-bold uppercase px-1 py-0.5 border border-emerald-400 bg-emerald-50 text-emerald-700">Filed</span> : <span className="text-[9px] font-bold uppercase px-1 py-0.5 border border-amber-400 bg-amber-50 text-amber-700">Pending</span>}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <span className="flex gap-1 justify-end">
                      <button onClick={() => onEdit(c)} className="px-2 py-0.5 border border-slate-400 bg-white text-slate-700 text-[9px] font-bold uppercase tracking-widest hover:bg-slate-50">Edit</button>
                      <button onClick={() => onDelete(c.id)} className="px-2 py-0.5 border border-red-400 bg-red-50 text-red-700 text-[9px] font-bold uppercase tracking-widest hover:bg-red-100">Del</button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
