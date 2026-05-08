import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw, Save, Settings, X } from 'lucide-react';
import api from '../../services/api';

type Status = 'PRESENT' | 'ABSENT' | 'HALF_DAY' | 'LATE' | 'EARLY_OUT' | 'LEAVE' | 'WEEKLY_OFF' | 'HOLIDAY';

interface EmployeeRef { id: string; empCode: string; firstName: string; lastName: string; departmentId?: string | null; }
interface DepartmentRef { id: string; name: string; }
interface ShiftRef { id: string; code: string; name: string; }
interface Shift {
  id: string; code: string; name: string;
  startTime: string; endTime: string;
  graceMinutes: number; earlyOutMinutes: number;
  hours: number; active: boolean;
}
interface Punch {
  id: string; employeeId: string; punchAt: string; direction: 'IN' | 'OUT' | 'AUTO';
  source: 'DEVICE' | 'MANUAL' | 'IMPORT'; deviceId: string | null; notes: string | null;
  // Backend enrichment — populated by /attendance/punches via BiometricDevice lookup
  deviceCode?: string | null; deviceLocation?: string | null; deviceName?: string | null;
  employee: EmployeeRef;
}

// Same-device re-tap dedup window (matches backend recomputeDay).
// eSSL devices fire a fresh punch on every successful match — a single
// scan often produces 2-3 hits a few seconds apart. Without dedup, the
// daily view shows "First In = 08:58, Last Out = 08:58" for someone
// who only tapped once. We collapse runs of <30s same-device hits into
// the FIRST hit (the actual moment the worker tapped).
const DEDUP_WINDOW_MS = 30_000;
function dedupePunches(sorted: Punch[]): Punch[] {
  const out: Punch[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (prev && prev.deviceId === p.deviceId
        && new Date(p.punchAt).getTime() - new Date(prev.punchAt).getTime() < DEDUP_WINDOW_MS) {
      continue;
    }
    out.push(p);
  }
  return out;
}

function deviceLabel(p: Punch): string {
  // Prefer the human-readable location, fall back to code, then name, then "?"
  return p.deviceLocation || p.deviceCode || p.deviceName || (p.deviceId ? p.deviceId.slice(0, 6) : '');
}
interface DayCell {
  id: string; status: Status;
  hoursWorked: number | null;
  lateMinutes: number | null;
  earlyOutMinutes: number | null;
  manualOverride: boolean;
}
interface MonthlyRow {
  employee: { id: string; empCode: string; firstName: string; lastName: string; department: { id: string; name: string } | null; defaultShift: ShiftRef | null };
  days: Record<number, DayCell>;
  summary: { present: number; absent: number; leave: number; halfDay: number; late: number; weeklyOff: number; holiday: number; totalDays: number };
}
interface MonthlyResp { year: number; month: number; daysInMonth: number; rows: MonthlyRow[]; }

const STATUS_COLOR: Record<Status, string> = {
  PRESENT: 'bg-emerald-500 text-white',
  ABSENT: 'bg-rose-500 text-white',
  HALF_DAY: 'bg-amber-500 text-white',
  LATE: 'bg-orange-500 text-white',
  EARLY_OUT: 'bg-orange-400 text-white',
  LEAVE: 'bg-indigo-500 text-white',
  WEEKLY_OFF: 'bg-slate-300 text-slate-700',
  HOLIDAY: 'bg-fuchsia-500 text-white',
};
const STATUS_LETTER: Record<Status, string> = {
  PRESENT: 'P', ABSENT: 'A', HALF_DAY: 'H', LATE: 'L', EARLY_OUT: 'E',
  LEAVE: 'LV', WEEKLY_OFF: 'WO', HOLIDAY: 'HO',
};
const ALL_STATUSES: Status[] = ['PRESENT', 'ABSENT', 'HALF_DAY', 'LATE', 'EARLY_OUT', 'LEAVE', 'WEEKLY_OFF', 'HOLIDAY'];

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtTime(iso: string | null): string {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function Attendance() {
  const [tab, setTab] = useState<'daily' | 'monthly' | 'shifts'>('daily');
  const [employees, setEmployees] = useState<EmployeeRef[]>([]);
  const [departments, setDepartments] = useState<DepartmentRef[]>([]);

  useEffect(() => {
    api.get('/employees?isActive=true').then(r => setEmployees((r.data?.employees || []).map((e: any) => ({
      id: e.id, empCode: e.empCode, firstName: e.firstName, lastName: e.lastName, departmentId: e.departmentId,
    }))));
    api.get('/departments').then(r => setDepartments(r.data || []));
  }, []);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center gap-3">
          <Calendar className="w-4 h-4" />
          <span className="text-sm font-bold tracking-wide uppercase">Attendance</span>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Punches, daily &amp; monthly view, shift master</span>
        </div>

        {/* Tabs */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2 flex gap-6">
          {(['daily', 'monthly', 'shifts'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[11px] font-bold uppercase tracking-widest pb-1 ${tab === t ? 'border-b-2 border-blue-600 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'daily' && <DailyView employees={employees} />}
        {tab === 'monthly' && <MonthlyView departments={departments} />}
        {tab === 'shifts' && <ShiftsView />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// DAILY VIEW
// ════════════════════════════════════════════════════════════════

function DailyView({ employees }: { employees: EmployeeRef[] }) {
  const [date, setDate] = useState(todayStr());
  const [punches, setPunches] = useState<Punch[]>([]);
  const [loading, setLoading] = useState(false);
  const [showEntry, setShowEntry] = useState(false);

  const fetchPunches = useCallback(async () => {
    setLoading(true);
    try {
      const from = new Date(`${date}T00:00:00+05:30`).toISOString();
      const to = new Date(`${date}T23:59:59+05:30`).toISOString();
      const r = await api.get<Punch[]>(`/attendance/punches?from=${from}&to=${to}&limit=1000`);
      setPunches(r.data);
    } finally { setLoading(false); }
  }, [date]);

  useEffect(() => { fetchPunches(); }, [fetchPunches]);

  // Group by employee. Skip any row without an employee join (defensive —
  // labor-only punches now exist and could leak in if backend filtering ever
  // regresses; sorting on a null .emp.empCode crashed the page on 2026-05-08).
  const grouped = useMemo(() => {
    const byEmp: Record<string, { emp: EmployeeRef; punches: Punch[] }> = {};
    for (const p of punches) {
      if (!p.employee || !p.employeeId) continue;
      if (!byEmp[p.employeeId]) byEmp[p.employeeId] = { emp: p.employee, punches: [] };
      byEmp[p.employeeId].punches.push(p);
    }
    return Object.values(byEmp).sort((a, b) => a.emp.empCode.localeCompare(b.emp.empCode));
  }, [punches]);

  return (
    <div>
      {/* Filter toolbar */}
      <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Date</label>
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="border border-slate-300 px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
        />
        <button
          onClick={fetchPunches}
          className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 inline-flex items-center gap-1"
        >
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
        <div className="flex-1" />
        <button
          onClick={() => setShowEntry(true)}
          className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> Manual Punch
        </button>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <Kpi label="Employees Punched" value={grouped.length} accent="emerald" />
        <Kpi label="Total Punches" value={punches.length} accent="blue" />
        <Kpi label="Manual Entries" value={punches.filter(p => p.source === 'MANUAL').length} accent="amber" />
        <Kpi label="Device Pushes" value={punches.filter(p => p.source === 'DEVICE').length} accent="indigo" />
      </div>

      {/* Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Emp Code</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Name</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">First In</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Last Out</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Total Punches</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest text-left">All Punches</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">
                  <Loader2 className="w-4 h-4 inline animate-spin mr-2" />Loading...
                </td></tr>
              )}
              {!loading && grouped.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No punches for {date}</td></tr>
              )}
              {!loading && grouped.map(g => {
                const sorted = [...g.punches].sort((a, b) => new Date(a.punchAt).getTime() - new Date(b.punchAt).getTime());
                const deduped = dedupePunches(sorted);
                const firstIn = deduped[0];
                const lastOut = deduped[deduped.length - 1];
                const onlyOneEffective = deduped.length === 1;
                const dropped = sorted.length - deduped.length;
                return (
                  <tr key={g.emp.id} className="border-b border-slate-100 even:bg-slate-50/70">
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{g.emp.empCode}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100">{g.emp.firstName} {g.emp.lastName}</td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono tabular-nums text-center">
                      <div>{fmtTime(firstIn.punchAt)}</div>
                      <div className="text-[9px] text-slate-400 font-normal">{deviceLabel(firstIn)}</div>
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono tabular-nums text-center">
                      {onlyOneEffective ? (
                        <span className="text-amber-600 font-semibold">--</span>
                      ) : (
                        <>
                          <div>{fmtTime(lastOut.punchAt)}</div>
                          <div className="text-[9px] text-slate-400 font-normal">{deviceLabel(lastOut)}</div>
                        </>
                      )}
                    </td>
                    <td className="px-3 py-1.5 border-r border-slate-100 font-mono tabular-nums text-center">
                      {deduped.length}
                      {dropped > 0 && <span className="text-[9px] text-slate-400 ml-1">(+{dropped} re-tap)</span>}
                    </td>
                    <td className="px-3 py-1.5 text-[11px] text-slate-500">
                      {deduped.map(p => (
                        <span
                          key={p.id}
                          title={`${p.source}${deviceLabel(p) ? ` · ${deviceLabel(p)}` : ''} · ${p.deviceCode ?? ''}`}
                          className={`inline-flex items-center gap-1 mr-1 px-1.5 py-0.5 border text-[10px] font-mono ${
                            p.source === 'DEVICE' ? 'border-emerald-300 bg-emerald-50' :
                            p.source === 'MANUAL' ? 'border-amber-300 bg-amber-50' :
                            'border-slate-300 bg-slate-50'
                          }`}
                        >
                          {fmtTime(p.punchAt)}
                          {deviceLabel(p) && (
                            <span className="text-[9px] text-slate-500 font-semibold">{deviceLabel(p)}</span>
                          )}
                        </span>
                      ))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {showEntry && <ManualPunchModal employees={employees} defaultDate={date} onClose={() => { setShowEntry(false); fetchPunches(); }} />}
    </div>
  );
}

function ManualPunchModal({ employees, defaultDate, onClose }: { employees: EmployeeRef[]; defaultDate: string; onClose: () => void }) {
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState(defaultDate);
  const [time, setTime] = useState('09:00');
  const [direction, setDirection] = useState<'IN' | 'OUT' | 'AUTO'>('AUTO');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!employeeId) { setErr('Select employee'); return; }
    setSaving(true);
    try {
      // Build IST instant: e.g. 2026-05-06T09:00 IST → ISO with +05:30
      const iso = new Date(`${date}T${time}:00+05:30`).toISOString();
      await api.post('/attendance/punches', { employeeId, punchAt: iso, direction, notes: notes || undefined, source: 'MANUAL' });
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl w-full max-w-md">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest">Manual Punch Entry</span>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <Field label="Employee">
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
              <option value="">— Select —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.empCode} — {e.firstName} {e.lastName}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Date"><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" /></Field>
            <Field label="Time (IST)"><input type="time" value={time} onChange={e => setTime(e.target.value)} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" /></Field>
          </div>
          <Field label="Direction">
            <select value={direction} onChange={e => setDirection(e.target.value as any)} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
              <option value="AUTO">AUTO</option>
              <option value="IN">IN</option>
              <option value="OUT">OUT</option>
            </select>
          </Field>
          <Field label="Notes">
            <input value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. forgot to punch" className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
          </Field>
          {err && <div className="text-[11px] text-rose-600 border border-rose-200 bg-rose-50 px-2 py-1">{err}</div>}
        </div>
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// MONTHLY VIEW
// ════════════════════════════════════════════════════════════════

function MonthlyView({ departments }: { departments: DepartmentRef[] }) {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [departmentId, setDepartmentId] = useState('');
  const [data, setData] = useState<MonthlyResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [overrideTarget, setOverrideTarget] = useState<{ rowEmp: MonthlyRow['employee']; dayNum: number; cell: DayCell | undefined; date: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ year: String(year), month: String(month) });
      if (departmentId) params.set('departmentId', departmentId);
      const r = await api.get<MonthlyResp>(`/attendance/monthly?${params}`);
      setData(r.data);
    } finally { setLoading(false); }
  }, [year, month, departmentId]);

  useEffect(() => { load(); }, [load]);

  async function recompute() {
    if (!data) return;
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const to = `${year}-${String(month).padStart(2, '0')}-${String(data.daysInMonth).padStart(2, '0')}`;
    setLoading(true);
    try {
      await api.post('/attendance/recompute', { from, to }, { timeout: 120_000 });
      await load();
    } finally { setLoading(false); }
  }

  function shiftMonth(delta: number) {
    let m = month + delta;
    let y = year;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    setMonth(m); setYear(y);
  }

  const monthName = new Date(year, month - 1, 1).toLocaleString('en', { month: 'long' });

  return (
    <div>
      {/* Filter toolbar */}
      <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
        <button onClick={() => shiftMonth(-1)} className="p-1 bg-white border border-slate-300 hover:bg-slate-50"><ChevronLeft className="w-3 h-3" /></button>
        <div className="text-xs font-bold tracking-widest uppercase text-slate-700 min-w-[140px] text-center">{monthName} {year}</div>
        <button onClick={() => shiftMonth(1)} className="p-1 bg-white border border-slate-300 hover:bg-slate-50"><ChevronRight className="w-3 h-3" /></button>

        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest ml-3">Dept</label>
        <select value={departmentId} onChange={e => setDepartmentId(e.target.value)} className="border border-slate-300 px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
          <option value="">All</option>
          {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <button onClick={load} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 inline-flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
        <div className="flex-1" />
        <button onClick={recompute} disabled={loading} className="px-3 py-1 bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700 disabled:opacity-50">
          Recompute Days
        </button>
      </div>

      {/* Legend */}
      <div className="bg-white border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex flex-wrap gap-3 text-[10px]">
        {ALL_STATUSES.map(s => (
          <span key={s} className="inline-flex items-center gap-1">
            <span className={`inline-block w-4 h-4 ${STATUS_COLOR[s]} text-[9px] font-bold flex items-center justify-center`}>{STATUS_LETTER[s]}</span>
            <span className="uppercase tracking-wider text-slate-600">{s.replace('_', ' ')}</span>
          </span>
        ))}
      </div>

      {/* Grid */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="text-[11px] border-collapse">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left sticky left-0 bg-slate-800 z-10">Code</th>
                <th className="px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Name</th>
                <th className="px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Dept</th>
                {data && Array.from({ length: data.daysInMonth }, (_, i) => i + 1).map(d => (
                  <th key={d} className="px-1 py-2 font-semibold text-[9px] uppercase tracking-widest border-r border-slate-700 w-7 text-center">{d}</th>
                ))}
                <th className="px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-center">P</th>
                <th className="px-2 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-center">A</th>
                <th className="px-2 py-2 font-semibold text-[10px] uppercase tracking-widest text-center">L</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan={4 + (data?.daysInMonth || 0) + 3} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">
                  <Loader2 className="w-4 h-4 inline animate-spin mr-2" />Loading...
                </td></tr>
              )}
              {!loading && data?.rows.length === 0 && (
                <tr><td colSpan={4 + data.daysInMonth + 3} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No employees</td></tr>
              )}
              {!loading && data?.rows.map(row => (
                <tr key={row.employee.id} className="border-b border-slate-100 even:bg-slate-50/70">
                  <td className="px-2 py-1 border-r border-slate-100 font-mono sticky left-0 bg-inherit">{row.employee.empCode}</td>
                  <td className="px-2 py-1 border-r border-slate-100 whitespace-nowrap">{row.employee.firstName} {row.employee.lastName}</td>
                  <td className="px-2 py-1 border-r border-slate-100 text-slate-500">{row.employee.department?.name || '--'}</td>
                  {Array.from({ length: data!.daysInMonth }, (_, i) => i + 1).map(d => {
                    const cell = row.days[d];
                    const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
                    return (
                      <td key={d} className="border-r border-slate-100 p-0 text-center">
                        <button
                          onClick={() => setOverrideTarget({ rowEmp: row.employee, dayNum: d, cell, date })}
                          title={cell ? `${cell.status}${cell.manualOverride ? ' (override)' : ''}` : 'no record'}
                          className={`block w-full h-6 text-[9px] font-bold ${cell ? STATUS_COLOR[cell.status] : 'bg-white text-slate-300'} ${cell?.manualOverride ? 'ring-1 ring-inset ring-yellow-300' : ''}`}
                        >
                          {cell ? STATUS_LETTER[cell.status] : '·'}
                        </button>
                      </td>
                    );
                  })}
                  <td className="px-2 py-1 border-r border-slate-100 text-center font-mono tabular-nums">{row.summary.present}</td>
                  <td className="px-2 py-1 border-r border-slate-100 text-center font-mono tabular-nums">{row.summary.absent}</td>
                  <td className="px-2 py-1 text-center font-mono tabular-nums">{row.summary.leave}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {overrideTarget && (
        <OverrideModal
          target={overrideTarget}
          onClose={() => { setOverrideTarget(null); load(); }}
        />
      )}
    </div>
  );
}

function OverrideModal({ target, onClose }: { target: { rowEmp: MonthlyRow['employee']; dayNum: number; cell: DayCell | undefined; date: string }; onClose: () => void }) {
  const [status, setStatus] = useState<Status>(target.cell?.status || 'PRESENT');
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    if (!reason.trim()) { setErr('Reason required'); return; }
    setSaving(true);
    try {
      if (!target.cell) {
        // No row exists yet — create via recompute first, then override. Simpler: ask backend to upsert via override path
        // We'll call recompute for that single day, then try the override.
        await api.post('/attendance/recompute', { from: target.date, to: target.date, employeeIds: [target.rowEmp.id] }, { timeout: 60_000 });
        // Fetch the new day id
        const r = await api.get(`/attendance/days?employeeId=${target.rowEmp.id}&from=${target.date}&to=${target.date}`);
        const newCell = (r.data || [])[0];
        if (newCell) {
          await api.put(`/attendance/days/${newCell.id}`, { status, reason });
        }
      } else {
        await api.put(`/attendance/days/${target.cell.id}`, { status, reason });
      }
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  }

  async function clearOverride() {
    if (!target.cell) return;
    setSaving(true);
    try {
      await api.post(`/attendance/days/${target.cell.id}/clear-override`);
      onClose();
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl w-full max-w-md">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest">Override Attendance</span>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-xs text-slate-700">
            <div><span className="text-slate-500">Employee: </span><b>{target.rowEmp.firstName} {target.rowEmp.lastName}</b> ({target.rowEmp.empCode})</div>
            <div><span className="text-slate-500">Date: </span><b>{target.date}</b></div>
            <div><span className="text-slate-500">Current: </span>{target.cell ? <span className={`px-1.5 py-0.5 text-[10px] font-bold ${STATUS_COLOR[target.cell.status]}`}>{target.cell.status}</span> : <i className="text-slate-400">no record</i>}</div>
          </div>
          <Field label="New Status">
            <select value={status} onChange={e => setStatus(e.target.value as Status)} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
              {ALL_STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Reason (required)">
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={2} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g. on-site duty, biometric not working" />
          </Field>
          {err && <div className="text-[11px] text-rose-600 border border-rose-200 bg-rose-50 px-2 py-1">{err}</div>}
        </div>
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-between gap-2">
          {target.cell?.manualOverride ? (
            <button onClick={clearOverride} disabled={saving} className="px-3 py-1 bg-white border border-rose-300 text-rose-600 text-[11px] font-medium hover:bg-rose-50 disabled:opacity-50">
              Clear Override
            </button>
          ) : <span />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
            <button onClick={save} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Override
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// SHIFTS VIEW
// ════════════════════════════════════════════════════════════════

function ShiftsView() {
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Partial<Shift> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get<Shift[]>('/attendance/shifts'); setShifts(r.data); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!editing) return;
    const isNew = !editing.id;
    if (isNew) {
      await api.post('/attendance/shifts', editing);
    } else {
      await api.put(`/attendance/shifts/${editing.id}`, editing);
    }
    setEditing(null);
    load();
  }

  return (
    <div>
      <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Shift Master — assign in Employee form (defaultShiftId)</span>
        <div className="flex-1" />
        <button
          onClick={() => setEditing({ code: '', name: '', startTime: '06:00', endTime: '14:00', graceMinutes: 15, earlyOutMinutes: 15, hours: 8, active: true })}
          className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 inline-flex items-center gap-1"
        >
          <Plus className="w-3 h-3" /> New Shift
        </button>
      </div>

      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Code</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Name</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Start</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">End</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Hours</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Grace (min)</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Early Out (min)</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Active</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest" />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest"><Loader2 className="w-4 h-4 inline animate-spin mr-2" />Loading...</td></tr>}
              {!loading && shifts.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No shifts. Create A/B/C and assign to employees.</td></tr>}
              {shifts.map(s => (
                <tr key={s.id} className="border-b border-slate-100 even:bg-slate-50/70">
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{s.code}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">{s.name}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono tabular-nums text-center">{s.startTime}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono tabular-nums text-center">{s.endTime}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono tabular-nums text-center">{s.hours}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono tabular-nums text-center">{s.graceMinutes}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono tabular-nums text-center">{s.earlyOutMinutes}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-center">
                    <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${s.active ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : 'border-slate-300 text-slate-500 bg-slate-50'}`}>{s.active ? 'Active' : 'Inactive'}</span>
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <button onClick={() => setEditing(s)} className="text-[11px] text-blue-600 hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white shadow-2xl w-full max-w-md">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">{editing.id ? 'Edit Shift' : 'New Shift'}</span>
              <button onClick={() => setEditing(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <Field label="Code"><input value={editing.code || ''} onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" /></Field>
              <Field label="Name"><input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" /></Field>
              <Field label="Start (HH:MM)"><input value={editing.startTime || ''} onChange={e => setEditing({ ...editing, startTime: e.target.value })} placeholder="06:00" className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
              <Field label="End (HH:MM)"><input value={editing.endTime || ''} onChange={e => setEditing({ ...editing, endTime: e.target.value })} placeholder="14:00" className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
              <Field label="Hours"><input type="number" step="0.5" value={editing.hours ?? 8} onChange={e => setEditing({ ...editing, hours: parseFloat(e.target.value) || 8 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
              <Field label="Grace (min)"><input type="number" value={editing.graceMinutes ?? 15} onChange={e => setEditing({ ...editing, graceMinutes: parseInt(e.target.value) || 0 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
              <Field label="Early Out (min)"><input type="number" value={editing.earlyOutMinutes ?? 15} onChange={e => setEditing({ ...editing, earlyOutMinutes: parseInt(e.target.value) || 0 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
              <Field label="Active">
                <select value={editing.active ? '1' : '0'} onChange={e => setEditing({ ...editing, active: e.target.value === '1' })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs">
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </Field>
            </div>
            <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
              <button onClick={save} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 inline-flex items-center gap-1">
                <Save className="w-3 h-3" /> Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// Helpers
// ════════════════════════════════════════════════════════════════

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">{label}</span>
      {children}
    </label>
  );
}

function Kpi({ label, value, accent }: { label: string; value: number | string; accent: 'emerald' | 'blue' | 'amber' | 'indigo' | 'rose' }) {
  const colors: Record<string, string> = {
    emerald: 'border-l-emerald-500', blue: 'border-l-blue-500',
    amber: 'border-l-amber-500', indigo: 'border-l-indigo-500', rose: 'border-l-rose-500',
  };
  return (
    <div className={`bg-white px-4 py-3 border-r border-slate-300 border-l-4 ${colors[accent]}`}>
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</div>
      <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{value}</div>
    </div>
  );
}
