import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HardHat, Loader2, Plus, RefreshCw, Save, X, Search } from 'lucide-react';
import api from '../../services/api';

const SKILL_CATEGORIES = ['UNSKILLED', 'SEMI_SKILLED', 'SKILLED'] as const;
type Skill = typeof SKILL_CATEGORIES[number];

interface ContractorRef { id: string; name: string; contractorCode: string | null; }
interface WorkOrderRef { id: string; woNo: number; title: string; contractType: string; }

interface LaborWorker {
  id: string;
  workerCode: string;
  workerNo: number;
  firstName: string;
  lastName: string | null;
  fatherName: string | null;
  phone: string | null;
  aadhaar: string | null;
  contractorId: string;
  workOrderId: string | null;
  skillCategory: string | null;
  dailyRate: number | null;
  deviceUserId: string | null;
  cardNumber: string | null;
  isActive: boolean;
  joinedAt: string;
  remarks: string | null;
  contractor: ContractorRef | null;
  workOrder: WorkOrderRef | null;
}

export default function LaborWorkers() {
  const [workers, setWorkers] = useState<LaborWorker[]>([]);
  const [contractors, setContractors] = useState<ContractorRef[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrderRef[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [filterContractor, setFilterContractor] = useState('');
  const [editing, setEditing] = useState<Partial<LaborWorker> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (filterContractor) params.set('contractorId', filterContractor);
      const r = await api.get(`/labor-workers?${params}`);
      setWorkers(r.data?.workers || []);
    } finally { setLoading(false); }
  }, [search, filterContractor]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.get('/contractors').then(r => setContractors(r.data?.contractors || r.data || []));
    api.get('/work-orders?contractType=MANPOWER_SUPPLY').then(r => {
      const wos = r.data?.workOrders || r.data || [];
      setWorkOrders(wos);
    }).catch(() => setWorkOrders([]));
  }, []);

  const stats = useMemo(() => ({
    total: workers.length,
    skilled: workers.filter(w => w.skillCategory === 'SKILLED').length,
    semi: workers.filter(w => w.skillCategory === 'SEMI_SKILLED').length,
    unskilled: workers.filter(w => w.skillCategory === 'UNSKILLED').length,
  }), [workers]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center gap-3">
          <HardHat className="w-4 h-4" />
          <span className="text-sm font-bold tracking-wide uppercase">Labor Workers</span>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Contractor-supplied workers — biometric attendance, separate from Employees</span>
        </div>

        {/* Filters */}
        <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, code, phone…" className="pl-7 pr-3 py-1 border border-slate-300 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-56" />
          </div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Contractor</label>
          <select value={filterContractor} onChange={e => setFilterContractor(e.target.value)} className="border border-slate-300 px-2.5 py-1 text-xs">
            <option value="">All</option>
            {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={load} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 inline-flex items-center gap-1">
            <RefreshCw className="w-3 h-3" /> Refresh
          </button>
          <div className="flex-1" />
          <button onClick={() => setEditing({ firstName: '', contractorId: contractors[0]?.id ?? '', skillCategory: 'UNSKILLED' })} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 inline-flex items-center gap-1">
            <Plus className="w-3 h-3" /> Add Labor Worker
          </button>
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
          <Kpi label="Total Active" value={stats.total} accent="emerald" />
          <Kpi label="Skilled" value={stats.skilled} accent="blue" />
          <Kpi label="Semi-skilled" value={stats.semi} accent="indigo" />
          <Kpi label="Unskilled" value={stats.unskilled} accent="amber" />
        </div>

        {/* Table */}
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-800 text-white">
                <tr>
                  <Th>Code</Th><Th>Name</Th><Th>Father</Th>
                  <Th>Contractor</Th><Th>Work Order</Th><Th>Skill</Th>
                  <Th>Daily Rate</Th><Th>Phone</Th><Th>Device User</Th><Th>Card</Th><Th>Joined</Th><Th />
                </tr>
              </thead>
              <tbody>
                {loading && <tr><td colSpan={12} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest"><Loader2 className="w-4 h-4 inline animate-spin mr-2" />Loading...</td></tr>}
                {!loading && workers.length === 0 && <tr><td colSpan={12} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No labor workers — add one to start</td></tr>}
                {workers.map(w => (
                  <tr key={w.id} className="border-b border-slate-100 even:bg-slate-50/70">
                    <Td mono>{w.workerCode}</Td>
                    <Td>{w.firstName} {w.lastName ?? ''}</Td>
                    <Td className="text-slate-500">{w.fatherName ?? '--'}</Td>
                    <Td>{w.contractor?.name ?? <span className="text-slate-400">--</span>}</Td>
                    <Td>{w.workOrder ? <span className="font-mono">WO-{w.workOrder.woNo}</span> : <span className="text-slate-400">--</span>}</Td>
                    <Td><SkillBadge skill={w.skillCategory} /></Td>
                    <Td mono className="text-right">{w.dailyRate ? `₹${w.dailyRate.toLocaleString('en-IN')}` : '--'}</Td>
                    <Td mono>{w.phone ?? '--'}</Td>
                    <Td mono className="text-center">{w.deviceUserId ?? <span className="text-slate-400">--</span>}</Td>
                    <Td mono className="text-center">{w.cardNumber ?? '--'}</Td>
                    <Td mono className="text-center">{w.joinedAt ? new Date(w.joinedAt).toLocaleDateString('en-IN') : '--'}</Td>
                    <Td className="text-right whitespace-nowrap"><button onClick={() => setEditing(w)} className="text-[11px] text-blue-600 hover:underline">Edit</button></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {editing && <FormModal initial={editing} contractors={contractors} workOrders={workOrders} onClose={() => { setEditing(null); load(); }} />}
      </div>
    </div>
  );
}

function FormModal({ initial, contractors, workOrders, onClose }: { initial: Partial<LaborWorker>; contractors: ContractorRef[]; workOrders: WorkOrderRef[]; onClose: () => void }) {
  const [w, setW] = useState<Partial<LaborWorker>>(initial);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Filter work orders by contractor
  const availableWOs = workOrders.filter(wo => {
    if (!w.contractorId) return false;
    return true; // Backend returns only manpower WOs already; show all (link by contractor on backend)
  });

  async function save() {
    setErr(null);
    if (!w.firstName?.trim() || !w.contractorId) { setErr('Name and contractor are required'); return; }
    setSaving(true);
    try {
      const payload = {
        firstName: w.firstName,
        lastName: w.lastName ?? null,
        fatherName: w.fatherName ?? null,
        phone: w.phone ?? null,
        aadhaar: w.aadhaar ?? null,
        contractorId: w.contractorId,
        workOrderId: w.workOrderId || null,
        skillCategory: w.skillCategory ?? null,
        dailyRate: w.dailyRate != null ? Number(w.dailyRate) : null,
        cardNumber: w.cardNumber ?? null,
        joinedAt: w.joinedAt ?? null,
        remarks: w.remarks ?? null,
        ...(w.id ? { isActive: w.isActive ?? true } : {}),
      };
      if (w.id) await api.put(`/labor-workers/${w.id}`, payload);
      else await api.post('/labor-workers', payload);
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest">{w.id ? `Edit Labor — ${w.workerCode ?? ''}` : 'Add Labor Worker'}</span>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Field label="First Name *"><input value={w.firstName ?? ''} onChange={e => setW({ ...w, firstName: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" autoFocus /></Field>
          <Field label="Last Name"><input value={w.lastName ?? ''} onChange={e => setW({ ...w, lastName: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" /></Field>
          <Field label="Father's Name"><input value={w.fatherName ?? ''} onChange={e => setW({ ...w, fatherName: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" /></Field>
          <Field label="Phone"><input value={w.phone ?? ''} onChange={e => setW({ ...w, phone: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
          <Field label="Aadhaar"><input value={w.aadhaar ?? ''} onChange={e => setW({ ...w, aadhaar: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
          <Field label="Card Number (RFID)"><input value={w.cardNumber ?? ''} onChange={e => setW({ ...w, cardNumber: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
          <Field label="Contractor *">
            <select value={w.contractorId ?? ''} onChange={e => setW({ ...w, contractorId: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs">
              <option value="">— Select —</option>
              {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
          <Field label="Work Order (optional)">
            <select value={w.workOrderId ?? ''} onChange={e => setW({ ...w, workOrderId: e.target.value || null })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs">
              <option value="">— None —</option>
              {availableWOs.map(wo => <option key={wo.id} value={wo.id}>WO-{wo.woNo} · {wo.title}</option>)}
            </select>
          </Field>
          <Field label="Skill Category">
            <select value={w.skillCategory ?? ''} onChange={e => setW({ ...w, skillCategory: e.target.value || null })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs">
              <option value="">— None —</option>
              {SKILL_CATEGORIES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
          </Field>
          <Field label="Daily Rate (₹)"><input type="number" step="0.01" value={w.dailyRate ?? ''} onChange={e => setW({ ...w, dailyRate: e.target.value ? parseFloat(e.target.value) : null })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
          <Field label="Joined At"><input type="date" value={w.joinedAt ? w.joinedAt.slice(0, 10) : ''} onChange={e => setW({ ...w, joinedAt: e.target.value || undefined })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" /></Field>
          {w.id && (
            <Field label="Active">
              <select value={w.isActive ? '1' : '0'} onChange={e => setW({ ...w, isActive: e.target.value === '1' })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs">
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </Field>
          )}
          <div className="col-span-2">
            <Field label="Remarks"><input value={w.remarks ?? ''} onChange={e => setW({ ...w, remarks: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" /></Field>
          </div>
          {w.deviceUserId && (
            <div className="col-span-2 text-[10px] text-slate-500 border-t border-slate-200 pt-2">
              Device user_id: <span className="font-mono">{w.deviceUserId}</span> — auto-assigned for biometric mapping (push to device happens automatically on save)
            </div>
          )}
          {err && <div className="col-span-2 text-[11px] text-rose-600 border border-rose-200 bg-rose-50 px-2 py-1">{err}</div>}
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

function SkillBadge({ skill }: { skill: string | null }) {
  if (!skill) return <span className="text-slate-400">--</span>;
  const colors: Record<string, string> = {
    SKILLED: 'border-blue-500 text-blue-700 bg-blue-50',
    SEMI_SKILLED: 'border-indigo-500 text-indigo-700 bg-indigo-50',
    UNSKILLED: 'border-amber-500 text-amber-700 bg-amber-50',
  };
  return <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${colors[skill] ?? 'border-slate-300 text-slate-500 bg-slate-50'}`}>{skill.replace('_', ' ')}</span>;
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">{children}</th>;
}
function Td({ children, mono = false, className = '' }: { children: React.ReactNode; mono?: boolean; className?: string }) {
  return <td className={`px-3 py-1.5 border-r border-slate-100 ${mono ? 'font-mono' : ''} ${className}`}>{children}</td>;
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">{label}</span>
      {children}
    </label>
  );
}
function Kpi({ label, value, accent }: { label: string; value: number; accent: 'emerald' | 'blue' | 'indigo' | 'amber' }) {
  const colors: Record<string, string> = {
    emerald: 'border-l-emerald-500', blue: 'border-l-blue-500', indigo: 'border-l-indigo-500', amber: 'border-l-amber-500',
  };
  return (
    <div className={`bg-white px-4 py-3 border-r border-slate-300 border-l-4 ${colors[accent]}`}>
      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{label}</div>
      <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{value}</div>
    </div>
  );
}
