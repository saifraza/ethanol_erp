import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Save, X, Check, Ban, Clock } from 'lucide-react';
import api from '../../services/api';
import { useAuth } from '../../context/AuthContext';

type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';

interface LeaveType { id: string; code: string; name: string; paid: boolean; defaultAnnualEntitlement: number; active: boolean; sortOrder: number; }
interface EmployeeRef { id: string; empCode: string; firstName: string; lastName: string; }
interface LeaveApplication {
  id: string; appNo: number; employeeId: string; leaveTypeId: string;
  fromDate: string; toDate: string; days: number; isHalfDay: boolean;
  reason: string; status: LeaveStatus;
  appliedAt: string; appliedBy: string;
  reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null;
  employee: EmployeeRef; leaveType: { id: string; code: string; name: string; paid: boolean };
}

const STATUS_BADGE: Record<LeaveStatus, string> = {
  PENDING: 'border-amber-500 text-amber-700 bg-amber-50',
  APPROVED: 'border-emerald-500 text-emerald-700 bg-emerald-50',
  REJECTED: 'border-rose-500 text-rose-700 bg-rose-50',
  CANCELLED: 'border-slate-300 text-slate-500 bg-slate-50',
};

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(s: string): string {
  return s.slice(0, 10).split('-').reverse().join('-');
}

export default function Leave() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'ADMIN';
  const [tab, setTab] = useState<'all' | 'types'>('all');
  const [apps, setApps] = useState<LeaveApplication[]>([]);
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [employees, setEmployees] = useState<EmployeeRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [filterStatus, setFilterStatus] = useState<LeaveStatus | ''>('');
  const [showApply, setShowApply] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterStatus) params.set('status', filterStatus);
      const [appsR, typesR] = await Promise.all([
        api.get<LeaveApplication[]>(`/leave/applications?${params}`),
        api.get<LeaveType[]>('/leave/types'),
      ]);
      setApps(appsR.data); setTypes(typesR.data);
    } finally { setLoading(false); }
  }, [filterStatus]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api.get('/employees?isActive=true').then(r => setEmployees((r.data?.employees || []).map((e: any) => ({
      id: e.id, empCode: e.empCode, firstName: e.firstName, lastName: e.lastName,
    }))));
  }, []);

  async function decide(id: string, status: 'APPROVED' | 'REJECTED', note?: string) {
    await api.put(`/leave/applications/${id}/decide`, { status, reviewNote: note });
    load();
  }

  async function cancel(id: string) {
    if (!confirm('Cancel this leave application?')) return;
    await api.put(`/leave/applications/${id}/cancel`);
    load();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center gap-3">
          <Clock className="w-4 h-4" />
          <span className="text-sm font-bold tracking-wide uppercase">Leave</span>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Apply, track, approve</span>
        </div>

        {/* Tabs */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2 flex gap-6">
          <button
            onClick={() => setTab('all')}
            className={`text-[11px] font-bold uppercase tracking-widest pb-1 ${tab === 'all' ? 'border-b-2 border-blue-600 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
          >Applications</button>
          <button
            onClick={() => setTab('types')}
            className={`text-[11px] font-bold uppercase tracking-widest pb-1 ${tab === 'types' ? 'border-b-2 border-blue-600 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
          >Leave Types</button>
        </div>

        {tab === 'all' && (
          <>
            {/* Filter toolbar */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
              <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Status</label>
              <select value={filterStatus} onChange={e => setFilterStatus(e.target.value as any)} className="border border-slate-300 px-2.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400">
                <option value="">All</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
              <div className="flex-1" />
              <button
                onClick={() => setShowApply(true)}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 inline-flex items-center gap-1"
              >
                <Plus className="w-3 h-3" /> Apply Leave
              </button>
            </div>

            {/* Table */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="bg-slate-800 text-white">
                    <tr>
                      <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">App #</th>
                      <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Employee</th>
                      <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Type</th>
                      <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">From</th>
                      <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">To</th>
                      <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Days</th>
                      <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Reason</th>
                      <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                      <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest" />
                    </tr>
                  </thead>
                  <tbody>
                    {loading && <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest"><Loader2 className="w-4 h-4 inline animate-spin mr-2" />Loading...</td></tr>}
                    {!loading && apps.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No applications</td></tr>}
                    {apps.map(a => (
                      <tr key={a.id} className="border-b border-slate-100 even:bg-slate-50/70">
                        <td className="px-3 py-1.5 border-r border-slate-100 text-center font-mono">LA-{a.appNo}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100">{a.employee.firstName} {a.employee.lastName} <span className="text-slate-400 font-mono">({a.employee.empCode})</span></td>
                        <td className="px-3 py-1.5 border-r border-slate-100">
                          <span className="font-mono text-[11px]">{a.leaveType.code}</span>
                          {!a.leaveType.paid && <span className="ml-1 text-[9px] text-rose-600 font-bold">LWP</span>}
                        </td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-center font-mono tabular-nums">{fmtDate(a.fromDate)}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-center font-mono tabular-nums">{fmtDate(a.toDate)}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-center font-mono tabular-nums">{a.days}{a.isHalfDay ? ' ½' : ''}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-slate-600 max-w-xs truncate" title={a.reason}>{a.reason}</td>
                        <td className="px-3 py-1.5 border-r border-slate-100 text-center">
                          <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${STATUS_BADGE[a.status]}`}>{a.status}</span>
                        </td>
                        <td className="px-3 py-1.5 text-right whitespace-nowrap">
                          {a.status === 'PENDING' && isAdmin && (
                            <>
                              <button onClick={() => decide(a.id, 'APPROVED')} title="Approve" className="text-emerald-600 hover:text-emerald-700 mr-2"><Check className="w-3.5 h-3.5 inline" /></button>
                              <button onClick={() => { const note = prompt('Reason for rejection?'); if (note) decide(a.id, 'REJECTED', note); }} title="Reject" className="text-rose-600 hover:text-rose-700 mr-2"><Ban className="w-3.5 h-3.5 inline" /></button>
                            </>
                          )}
                          {(a.status === 'PENDING' || a.status === 'APPROVED') && (
                            <button onClick={() => cancel(a.id)} className="text-[11px] text-slate-500 hover:underline">Cancel</button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {tab === 'types' && <LeaveTypesView types={types} reload={load} isAdmin={isAdmin} />}

        {showApply && <ApplyLeaveModal types={types} employees={employees} onClose={() => { setShowApply(false); load(); }} />}
      </div>
    </div>
  );
}

function ApplyLeaveModal({ types, employees, onClose }: { types: LeaveType[]; employees: EmployeeRef[]; onClose: () => void }) {
  const [employeeId, setEmployeeId] = useState('');
  const [leaveTypeId, setLeaveTypeId] = useState('');
  const [fromDate, setFromDate] = useState(todayStr());
  const [toDate, setToDate] = useState(todayStr());
  const [isHalfDay, setIsHalfDay] = useState(false);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const days = useMemo(() => {
    if (!fromDate || !toDate) return 0;
    if (isHalfDay) return 0.5;
    const ms = new Date(toDate).getTime() - new Date(fromDate).getTime();
    return Math.floor(ms / (24 * 60 * 60 * 1000)) + 1;
  }, [fromDate, toDate, isHalfDay]);

  async function save() {
    setErr(null);
    if (!employeeId || !leaveTypeId || !reason) { setErr('All fields required'); return; }
    setSaving(true);
    try {
      await api.post('/leave/applications', { employeeId, leaveTypeId, fromDate, toDate, isHalfDay, reason });
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl w-full max-w-md">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest">Apply for Leave</span>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <Field label="Employee">
            <select value={employeeId} onChange={e => setEmployeeId(e.target.value)} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs">
              <option value="">— Select —</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.empCode} — {e.firstName} {e.lastName}</option>)}
            </select>
          </Field>
          <Field label="Leave Type">
            <select value={leaveTypeId} onChange={e => setLeaveTypeId(e.target.value)} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs">
              <option value="">— Select —</option>
              {types.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.code} — {t.name} {t.paid ? '' : '(unpaid)'}</option>)}
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="From"><input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" /></Field>
            <Field label="To"><input type="date" value={toDate} onChange={e => { setToDate(e.target.value); if (isHalfDay) setFromDate(e.target.value); }} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" disabled={isHalfDay} /></Field>
          </div>
          <label className="inline-flex items-center gap-2 text-xs">
            <input type="checkbox" checked={isHalfDay} onChange={e => { setIsHalfDay(e.target.checked); if (e.target.checked) setToDate(fromDate); }} />
            <span>Half-day (single date)</span>
          </label>
          <Field label="Reason">
            <textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" />
          </Field>
          <div className="text-[11px] text-slate-500"><b className="font-mono">{days}</b> day(s) requested</div>
          {err && <div className="text-[11px] text-rose-600 border border-rose-200 bg-rose-50 px-2 py-1">{err}</div>}
        </div>
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Submit
          </button>
        </div>
      </div>
    </div>
  );
}

function LeaveTypesView({ types, reload, isAdmin }: { types: LeaveType[]; reload: () => void; isAdmin: boolean }) {
  const [editing, setEditing] = useState<Partial<LeaveType> | null>(null);

  async function save() {
    if (!editing) return;
    if (editing.id) {
      await api.put(`/leave/types/${editing.id}`, editing);
    } else {
      await api.post('/leave/types', editing);
    }
    setEditing(null);
    reload();
  }

  return (
    <div>
      <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Common: CL, SL, EL, ML, COMP_OFF, LWP</span>
        <div className="flex-1" />
        {isAdmin && (
          <button
            onClick={() => setEditing({ code: '', name: '', paid: true, defaultAnnualEntitlement: 0, active: true, sortOrder: 0 })}
            className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 inline-flex items-center gap-1"
          >
            <Plus className="w-3 h-3" /> New Type
          </button>
        )}
      </div>
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-slate-800 text-white">
            <tr>
              <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Code</th>
              <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Name</th>
              <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Paid</th>
              <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Annual</th>
              <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Active</th>
              <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest" />
            </tr>
          </thead>
          <tbody>
            {types.length === 0 && <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No types — create CL, SL, EL to start</td></tr>}
            {types.map(t => (
              <tr key={t.id} className="border-b border-slate-100 even:bg-slate-50/70">
                <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{t.code}</td>
                <td className="px-3 py-1.5 border-r border-slate-100">{t.name}</td>
                <td className="px-3 py-1.5 border-r border-slate-100 text-center">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${t.paid ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : 'border-rose-500 text-rose-700 bg-rose-50'}`}>{t.paid ? 'Paid' : 'LWP'}</span>
                </td>
                <td className="px-3 py-1.5 border-r border-slate-100 text-center font-mono tabular-nums">{t.defaultAnnualEntitlement}</td>
                <td className="px-3 py-1.5 border-r border-slate-100 text-center">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${t.active ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : 'border-slate-300 text-slate-500 bg-slate-50'}`}>{t.active ? 'Active' : 'Inactive'}</span>
                </td>
                <td className="px-3 py-1.5 text-right">
                  {isAdmin && <button onClick={() => setEditing(t)} className="text-[11px] text-blue-600 hover:underline">Edit</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white shadow-2xl w-full max-w-md">
            <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-bold uppercase tracking-widest">{editing.id ? 'Edit' : 'New'} Leave Type</span>
              <button onClick={() => setEditing(null)}><X className="w-4 h-4" /></button>
            </div>
            <div className="p-4 grid grid-cols-2 gap-3">
              <Field label="Code"><input value={editing.code || ''} onChange={e => setEditing({ ...editing, code: e.target.value.toUpperCase() })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
              <Field label="Name"><input value={editing.name || ''} onChange={e => setEditing({ ...editing, name: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" /></Field>
              <Field label="Paid">
                <select value={editing.paid ? '1' : '0'} onChange={e => setEditing({ ...editing, paid: e.target.value === '1' })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs">
                  <option value="1">Paid</option>
                  <option value="0">Unpaid (LWP)</option>
                </select>
              </Field>
              <Field label="Default Annual"><input type="number" step="0.5" value={editing.defaultAnnualEntitlement ?? 0} onChange={e => setEditing({ ...editing, defaultAnnualEntitlement: parseFloat(e.target.value) || 0 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
              <Field label="Active">
                <select value={editing.active ? '1' : '0'} onChange={e => setEditing({ ...editing, active: e.target.value === '1' })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs">
                  <option value="1">Active</option>
                  <option value="0">Inactive</option>
                </select>
              </Field>
              <Field label="Sort Order"><input type="number" value={editing.sortOrder ?? 0} onChange={e => setEditing({ ...editing, sortOrder: parseInt(e.target.value) || 0 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">{label}</span>
      {children}
    </label>
  );
}
