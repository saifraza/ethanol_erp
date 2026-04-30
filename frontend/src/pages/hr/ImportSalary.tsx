import { useState, useRef } from 'react';
import api from '../../services/api';

interface PreviewEmployee {
  key: string;
  name: string;
  designation?: string;
  category: string;
  paymentMode: string;
  section?: string;
  pfAcNo?: string;
  existingEmpId?: string;
  existingEmpCode?: string;
  action: 'MATCH' | 'CREATE';
  basic: number;
  conv: number;
  medical: number;
  hra: number;
  mobileOther: number;
  ewa: number;
  ew: number;
  additional: number;
  petrol: number;
  mobile: number;
  pfDeduction: number;
  tds: number;
  advance: number;
  gross: number;
  totalDeductions: number;
  net: number;
  sourceFiles: string[];
}

interface PreviewSummary {
  totalRowsParsed: number;
  uniqueEmployees: number;
  matched: number;
  willCreate: number;
  filesProcessed: { name: string; size: number }[];
  totals: { gross: number; ded: number; net: number; tds: number; pf: number; adv: number; cash: number; bank: number };
}

const fmtINR = (n: number): string => '₹' + (n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });
const MONTHS = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const CAT_BADGE: Record<string, string> = {
  SENIOR: 'border-indigo-400 bg-indigo-50 text-indigo-700',
  PF: 'border-blue-400 bg-blue-50 text-blue-700',
  NPF: 'border-amber-400 bg-amber-50 text-amber-700',
  ADDITIONAL: 'border-purple-400 bg-purple-50 text-purple-700',
  CANE_PETROL: 'border-emerald-400 bg-emerald-50 text-emerald-700',
  CANE_MOBILE: 'border-emerald-400 bg-emerald-50 text-emerald-700',
};

export default function ImportSalary() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() === 0 ? 12 : now.getMonth());
  const [year, setYear] = useState(now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear());

  const [preview, setPreview] = useState<{ summary: PreviewSummary; employees: PreviewEmployee[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [committed, setCommitted] = useState<any>(null);
  const [filter, setFilter] = useState({ category: '', action: '', search: '' });

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) setFiles(Array.from(e.target.files));
    setPreview(null);
    setCommitted(null);
  };

  const runPreview = async () => {
    if (!files.length) { alert('Select at least 1 xlsx file'); return; }
    setLoading(true);
    setCommitted(null);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      const res = await api.post('/hr/import-salary/preview', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 60000 });
      setPreview(res.data);
    } catch (err: unknown) {
      alert(err.response?.data?.error || 'Preview failed');
    } finally {
      setLoading(false);
    }
  };

  const runCommit = async () => {
    if (!preview) { alert('Run preview first'); return; }
    if (!confirm(`Write ${preview.summary.uniqueEmployees} employees + payroll lines for ${MONTHS[month]} ${year}? This will replace any existing DRAFT/COMPUTED run for that period.`)) return;
    setCommitting(true);
    try {
      const fd = new FormData();
      for (const f of files) fd.append('files', f);
      fd.append('month', String(month));
      fd.append('year', String(year));
      const res = await api.post('/hr/import-salary/commit', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 });
      setCommitted(res.data);
    } catch (err: unknown) {
      alert(err.response?.data?.error || 'Commit failed');
    } finally {
      setCommitting(false);
    }
  };

  const filtered = preview?.employees.filter(e => {
    if (filter.category && e.category !== filter.category) return false;
    if (filter.action && e.action !== filter.action) return false;
    if (filter.search && !`${e.name} ${e.designation}`.toLowerCase().includes(filter.search.toLowerCase())) return false;
    return true;
  }) || [];

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Import Salary Sheet</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Upload MSPIL Excel sheets · auto-parses Senior / PF / NPF / Additional / Cane</span>
          </div>
          <span className="text-[10px] text-slate-400">Auto-parses Senior / PF / NPF / Additional / Cane sheets</span>
        </div>

        {/* Upload bar */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-3 -mx-3 md:-mx-6 flex items-end gap-3 flex-wrap">
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
          <div className="flex-1 min-w-[280px]">
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Excel Files (.xlsx) · multiple OK</label>
            <input ref={fileRef} type="file" multiple accept=".xlsx,.xls" onChange={onFileChange} className="block w-full text-xs file:mr-3 file:px-3 file:py-1 file:border-0 file:bg-blue-600 file:text-white file:text-[10px] file:font-bold file:uppercase file:tracking-widest file:hover:bg-blue-700 border border-slate-300 py-1" />
            {files.length > 0 && <div className="text-[10px] mt-1 text-slate-500">{files.length} file(s) selected: {files.map(f => f.name).join(', ')}</div>}
          </div>
          <button onClick={runPreview} disabled={loading || !files.length} className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-blue-700 disabled:opacity-50">
            {loading ? 'Parsing…' : 'Preview'}
          </button>
          {preview && !committed && (
            <button onClick={runCommit} disabled={committing} className="px-4 py-1.5 bg-emerald-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-700 disabled:opacity-50">
              {committing ? 'Committing…' : `Commit (${preview.summary.uniqueEmployees} employees)`}
            </button>
          )}
        </div>

        {/* Help */}
        {!preview && !files.length && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white px-6 py-8">
            <div className="max-w-3xl mx-auto">
              <div className="text-sm font-bold uppercase tracking-widest text-slate-700 mb-3">Supported MSPIL Excel templates</div>
              <ul className="text-xs text-slate-600 space-y-2 list-disc pl-5">
                <li><strong>Senior staff March YYYY - RTGS.xlsx</strong> — directors and senior managers (Basic/Conv/Med/HRA/Mobile + TDS column)</li>
                <li><strong>Ethanol Plant NPF March YYYY - Cash.xlsx</strong> / <strong>RTGS.xlsx</strong> — non-PF employees, with section headers (Account Office, Lab, etc.)</li>
                <li><strong>2.PF March YYYY - RTGS.xlsx</strong> — PF employees with PF A/c No., EW (Extra Work) days, PF deduction</li>
                <li><strong>3. NPF March YYYY - Cash.xlsx</strong> — additional cash-paid non-PF employees (peons, drivers, contract)</li>
                <li><strong>4. Additional March YYYY - Cash.xlsx</strong> — one-off bonuses for senior staff</li>
                <li><strong>5. Cane Petrol and Mobile March YYYY - Cash.xlsx</strong> — Cane dept reimbursements (petrol + mobile, two sheets)</li>
              </ul>
              <div className="text-xs text-slate-500 mt-4">
                Upload all 7 files together for a complete monthly import. The parser auto-detects type by filename + sheet structure. Employees are matched by name (fuzzy); unmatched names are created as new employees.
              </div>
            </div>
          </div>
        )}

        {/* Committed result */}
        {committed && (
          <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-emerald-50 border-emerald-300 px-6 py-6">
            <div className="text-emerald-800 font-bold uppercase tracking-widest text-sm mb-2">✓ Imported Successfully</div>
            <div className="text-xs text-emerald-700 space-y-1">
              <div><strong>Run:</strong> {MONTHS[committed.month]} {committed.year} (status: COMPUTED)</div>
              <div><strong>Lines:</strong> {committed.linesWritten}</div>
              <div><strong>Gross:</strong> {fmtINR(committed.totals.gross)} · <strong>Deductions:</strong> {fmtINR(committed.totals.deductions)} · <strong>Net:</strong> {fmtINR(committed.totals.net)}</div>
              <div><strong>TDS:</strong> {fmtINR(committed.totals.tds)} · <strong>PF:</strong> {fmtINR(committed.totals.pf)}</div>
            </div>
            <div className="mt-4 flex gap-2">
              <a href="/hr/payroll" className="px-3 py-1.5 bg-emerald-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-700">Open Payroll Run →</a>
              <a href="/hr/pay-today" className="px-3 py-1.5 border border-emerald-500 bg-white text-emerald-700 text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-50">Pay Today →</a>
              <a href="/hr/tds-report" className="px-3 py-1.5 border border-emerald-500 bg-white text-emerald-700 text-[11px] font-bold uppercase tracking-widest hover:bg-emerald-50">TDS Report →</a>
            </div>
          </div>
        )}

        {/* Preview */}
        {preview && (
          <>
            {/* KPI strip */}
            <div className="grid grid-cols-2 md:grid-cols-7 gap-0 -mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white">
              {[
                { label: 'Files', value: preview.summary.filesProcessed.length, isCount: true, color: 'text-slate-800' },
                { label: 'Rows Parsed', value: preview.summary.totalRowsParsed, isCount: true, color: 'text-slate-800' },
                { label: 'Employees', value: preview.summary.uniqueEmployees, isCount: true, color: 'text-blue-700' },
                { label: 'Match (Existing)', value: preview.summary.matched, isCount: true, color: 'text-emerald-700' },
                { label: 'New (Will Create)', value: preview.summary.willCreate, isCount: true, color: 'text-amber-700' },
                { label: 'Total Gross', value: preview.summary.totals.gross, color: 'text-slate-800' },
                { label: 'Total Net', value: preview.summary.totals.net, color: 'text-emerald-700' },
              ].map((c, i) => (
                <div key={i} className="px-4 py-2.5 border-r border-slate-200 last:border-r-0">
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{c.label}</div>
                  <div className={`text-sm font-mono font-bold ${c.color}`}>{c.isCount ? c.value : fmtINR(c.value)}</div>
                </div>
              ))}
            </div>

            {/* Secondary stats */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-0 -mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-50">
              {[
                { label: 'TDS', value: preview.summary.totals.tds, color: 'text-red-700' },
                { label: 'PF (Employee)', value: preview.summary.totals.pf, color: 'text-red-700' },
                { label: 'Advance', value: preview.summary.totals.adv, color: 'text-orange-700' },
                { label: 'Cash Payout', value: preview.summary.totals.cash, color: 'text-amber-700' },
                { label: 'Bank Payout', value: preview.summary.totals.bank, color: 'text-indigo-700' },
              ].map((c, i) => (
                <div key={i} className="px-4 py-2 border-r border-slate-200 last:border-r-0">
                  <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">{c.label}</div>
                  <div className={`text-xs font-mono font-bold ${c.color}`}>{fmtINR(c.value)}</div>
                </div>
              ))}
            </div>

            {/* Filter bar */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-end gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Search</label>
                <input type="text" value={filter.search} onChange={e => setFilter({ ...filter, search: e.target.value })} placeholder="Name, designation..." className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Category</label>
                <select value={filter.category} onChange={e => setFilter({ ...filter, category: e.target.value })} className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="">All</option>
                  <option value="SENIOR">Senior</option>
                  <option value="PF">PF</option>
                  <option value="NPF">Non-PF</option>
                  <option value="ADDITIONAL">Additional</option>
                  <option value="CANE_PETROL">Cane Petrol</option>
                  <option value="CANE_MOBILE">Cane Mobile</option>
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5">Action</label>
                <select value={filter.action} onChange={e => setFilter({ ...filter, action: e.target.value })} className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500">
                  <option value="">All</option>
                  <option value="MATCH">Match (Existing)</option>
                  <option value="CREATE">Create (New)</option>
                </select>
              </div>
              <div className="text-[10px] text-slate-500 self-center ml-auto">{filtered.length} of {preview.employees.length}</div>
            </div>

            {/* Preview table */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-x-auto" style={{ maxHeight: '60vh' }}>
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10"><tr className="bg-slate-800 text-white">
                  {['Action', 'Name / Designation', 'Cat', 'Mode', 'Section', 'Basic', 'Conv', 'Med', 'HRA', 'Other', 'EWA', 'EW', 'Add\'l', 'Petrol', 'Mobile', 'PF', 'TDS', 'Adv', 'Net'].map(h => (
                    <th key={h} className="px-2 py-1.5 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left last:border-r-0 last:text-right">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {filtered.map((e, i) => (
                    <tr key={e.key} className={`border-b border-slate-100 hover:bg-blue-50/40 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-2 py-0.5 border-r border-slate-100">
                        {e.action === 'MATCH' ? (
                          <span className="text-[9px] font-bold uppercase px-1 py-0.5 border border-emerald-400 bg-emerald-50 text-emerald-700">{e.existingEmpCode || 'M'}</span>
                        ) : (
                          <span className="text-[9px] font-bold uppercase px-1 py-0.5 border border-amber-400 bg-amber-50 text-amber-700">NEW</span>
                        )}
                      </td>
                      <td className="px-2 py-0.5 border-r border-slate-100">
                        <div className="font-medium">{e.name}</div>
                        <div className="text-[10px] text-slate-500">{e.designation || '—'} {e.pfAcNo && `· PF#${e.pfAcNo}`}</div>
                      </td>
                      <td className="px-2 py-0.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1 py-0.5 border ${CAT_BADGE[e.category] || ''}`}>{e.category}</span>
                      </td>
                      <td className="px-2 py-0.5 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase ${e.paymentMode === 'CASH' ? 'text-amber-700' : 'text-indigo-700'}`}>{e.paymentMode}</span>
                      </td>
                      <td className="px-2 py-0.5 text-[10px] text-slate-500 border-r border-slate-100">{e.section || '—'}</td>
                      <td className="px-2 py-0.5 text-right font-mono border-r border-slate-100">{fmtINR(e.basic)}</td>
                      <td className="px-2 py-0.5 text-right font-mono border-r border-slate-100">{fmtINR(e.conv)}</td>
                      <td className="px-2 py-0.5 text-right font-mono border-r border-slate-100">{fmtINR(e.medical)}</td>
                      <td className="px-2 py-0.5 text-right font-mono border-r border-slate-100">{fmtINR(e.hra)}</td>
                      <td className="px-2 py-0.5 text-right font-mono border-r border-slate-100">{fmtINR(e.mobileOther)}</td>
                      <td className="px-2 py-0.5 text-right font-mono text-blue-700 border-r border-slate-100">{fmtINR(e.ewa)}</td>
                      <td className="px-2 py-0.5 text-right font-mono text-blue-700 border-r border-slate-100">{fmtINR(e.ew)}</td>
                      <td className="px-2 py-0.5 text-right font-mono text-purple-700 border-r border-slate-100">{fmtINR(e.additional)}</td>
                      <td className="px-2 py-0.5 text-right font-mono text-emerald-700 border-r border-slate-100">{fmtINR(e.petrol)}</td>
                      <td className="px-2 py-0.5 text-right font-mono text-emerald-700 border-r border-slate-100">{fmtINR(e.mobile)}</td>
                      <td className="px-2 py-0.5 text-right font-mono text-red-700 border-r border-slate-100">{fmtINR(e.pfDeduction)}</td>
                      <td className="px-2 py-0.5 text-right font-mono text-red-700 border-r border-slate-100">{fmtINR(e.tds)}</td>
                      <td className="px-2 py-0.5 text-right font-mono text-red-700 border-r border-slate-100">{fmtINR(e.advance)}</td>
                      <td className="px-2 py-0.5 text-right font-mono font-bold text-emerald-700">{fmtINR(e.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="px-4 py-2 -mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-50 text-[10px] text-slate-500">
              <strong>Note:</strong> Click <strong>Commit</strong> above to create the {MONTHS[month]} {year} payroll run with these {preview.summary.uniqueEmployees} employees. New employees ({preview.summary.willCreate}) will be created in Employee master. Existing matched employees keep their current empCode and salary structure (this run snapshot is independent).
            </div>
          </>
        )}
      </div>
    </div>
  );
}
