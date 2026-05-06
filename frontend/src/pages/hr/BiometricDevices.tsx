import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Fingerprint, Loader2, Plus, RefreshCw, Save, X, Wifi, WifiOff, Check, AlertTriangle, Clock, UploadCloud, DownloadCloud } from 'lucide-react';
import api from '../../services/api';

interface BiometricDevice {
  id: string;
  code: string;
  name: string;
  location: string | null;
  ip: string;
  port: number;
  password: number;
  serialNumber: string | null;
  firmware: string | null;
  platform: string | null;
  active: boolean;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  lastSyncError: string | null;
  lastPunchSyncAt: string | null;
  notes: string | null;
  autoPullMinutes: number;
  autoPushMinutes: number;
  lastAutoPullAt: string | null;
  lastAutoPushAt: string | null;
}

interface DeviceUser {
  uid: number;
  user_id: string;
  name: string;
  privilege: number;
  card: number;
  group_id: string;
}

interface ERPEmpRef {
  id: string;
  empCode: string;
  empNo: number;
  firstName: string;
  lastName: string;
  deviceUserId: string | null;
}

interface MatchedRow {
  deviceUser: DeviceUser;
  employee: ERPEmpRef;
  matchKind: 'EXISTING' | 'NAME';
}
interface AmbiguousRow {
  deviceUser: DeviceUser;
  candidates: ERPEmpRef[];
}
interface UnmatchedRow {
  deviceUser: DeviceUser;
}

interface PullUsersResp {
  deviceCount: number;
  matched: MatchedRow[];
  ambiguous: AmbiguousRow[];
  unmatched: UnmatchedRow[];
  summary: { matched: number; ambiguous: number; unmatched: number };
}

interface BridgeHealth { reachable: boolean; service?: string; key_set?: boolean; error?: string; }

function fmtTime(iso: string | null): string {
  if (!iso) return '--';
  const d = new Date(iso);
  return d.toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

export default function BiometricDevices() {
  const [tab, setTab] = useState<'devices' | 'mapping' | 'ops'>('devices');
  const [devices, setDevices] = useState<BiometricDevice[]>([]);
  const [bridgeStatus, setBridgeStatus] = useState<BridgeHealth | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState<Partial<BiometricDevice> | null>(null);

  const loadDevices = useCallback(async () => {
    setLoading(true);
    try { const r = await api.get<BiometricDevice[]>('/biometric/devices'); setDevices(r.data); }
    finally { setLoading(false); }
  }, []);

  const loadBridge = useCallback(async () => {
    try { const r = await api.get<BridgeHealth>('/biometric/bridge-health'); setBridgeStatus(r.data); }
    catch { setBridgeStatus({ reachable: false, error: 'unreachable' }); }
  }, []);

  useEffect(() => { loadDevices(); loadBridge(); }, [loadDevices, loadBridge]);

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center gap-3">
          <Fingerprint className="w-4 h-4" />
          <span className="text-sm font-bold tracking-wide uppercase">Biometric Devices</span>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">eSSL / ZKTeco — devices, mapping, sync</span>
          <div className="flex-1" />
          {/* Bridge health pill */}
          {bridgeStatus && (
            <span className={`text-[9px] font-bold uppercase tracking-widest px-2 py-0.5 border ${bridgeStatus.reachable ? 'border-emerald-400 text-emerald-300' : 'border-rose-400 text-rose-300'}`}>
              Bridge {bridgeStatus.reachable ? 'OK' : 'DOWN'}
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="bg-white border-x border-b border-slate-300 -mx-3 md:-mx-6 px-4 py-2 flex gap-6">
          {(['devices', 'mapping', 'ops'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`text-[11px] font-bold uppercase tracking-widest pb-1 ${tab === t ? 'border-b-2 border-blue-600 text-slate-800' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {t === 'devices' ? 'Devices' : t === 'mapping' ? 'User Mapping' : 'Sync Operations'}
            </button>
          ))}
        </div>

        {tab === 'devices' && (
          <DevicesView
            devices={devices}
            loading={loading}
            reload={loadDevices}
            edit={setEditing}
          />
        )}
        {tab === 'mapping' && <MappingView devices={devices} />}
        {tab === 'ops' && <OpsView devices={devices} reload={loadDevices} />}

        {editing && <DeviceFormModal initial={editing} onClose={() => { setEditing(null); loadDevices(); }} />}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════
// DEVICES TAB
// ════════════════════════════════════════════════════════════════

function DevicesView({ devices, loading, reload, edit }: { devices: BiometricDevice[]; loading: boolean; reload: () => void; edit: (d: Partial<BiometricDevice>) => void }) {
  const [testing, setTesting] = useState<string | null>(null);

  async function test(d: BiometricDevice) {
    setTesting(d.id);
    try {
      const r = await api.post(`/biometric/devices/${d.id}/test`);
      alert(`✓ Connected\nFirmware: ${r.data.info.firmware}\nSerial: ${r.data.info.serial}\nUsers on device: ${r.data.info.user_count}\nLogs on device: ${r.data.info.log_count}`);
      reload();
    } catch (e: any) {
      alert(`✗ ${e?.response?.data?.error || e?.message || 'Failed'}`);
    } finally { setTesting(null); }
  }

  return (
    <div>
      <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3">
        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Configured devices on plant LAN</span>
        <div className="flex-1" />
        <button onClick={reload} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50 inline-flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Refresh
        </button>
        <button onClick={() => edit({ code: '', name: '', ip: '', port: 4370, password: 0, active: true })} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 inline-flex items-center gap-1">
          <Plus className="w-3 h-3" /> New Device
        </button>
      </div>

      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-slate-800 text-white">
              <tr>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Code</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Name</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700 text-left">Location</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">IP : Port</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Firmware</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Last Sync</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Auto-Sync</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest" />
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest"><Loader2 className="w-4 h-4 inline animate-spin mr-2" />Loading...</td></tr>}
              {!loading && devices.length === 0 && <tr><td colSpan={9} className="px-3 py-6 text-center text-xs text-slate-400 uppercase tracking-widest">No devices configured. Add one to start.</td></tr>}
              {devices.map(d => (
                <tr key={d.id} className="border-b border-slate-100 even:bg-slate-50/70">
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono">{d.code}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100">{d.name}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-slate-500">{d.location || '--'}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 font-mono text-center">{d.ip}:{d.port}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-[11px] text-slate-500">{d.firmware || '--'}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-[11px] text-slate-500 whitespace-nowrap">{fmtTime(d.lastSyncAt)}</td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-[10px] text-slate-500 whitespace-nowrap text-center">
                    {(d.autoPullMinutes > 0 || d.autoPushMinutes > 0) ? (
                      <span>
                        {d.autoPullMinutes > 0 && <span title="auto pull punches" className="font-mono">↓ {d.autoPullMinutes}m</span>}
                        {d.autoPullMinutes > 0 && d.autoPushMinutes > 0 && <span> · </span>}
                        {d.autoPushMinutes > 0 && <span title="auto push employees" className="font-mono">↑ {d.autoPushMinutes}m</span>}
                      </span>
                    ) : <span className="text-slate-400">manual</span>}
                  </td>
                  <td className="px-3 py-1.5 border-r border-slate-100 text-center">
                    {d.lastSyncStatus === 'OK' ? <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-emerald-500 text-emerald-700 bg-emerald-50 inline-flex items-center gap-1"><Wifi className="w-2.5 h-2.5" /> OK</span>
                      : d.lastSyncStatus === 'ERROR' ? <span title={d.lastSyncError ?? ''} className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-rose-500 text-rose-700 bg-rose-50 inline-flex items-center gap-1"><WifiOff className="w-2.5 h-2.5" /> Error</span>
                      : <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 text-slate-500 bg-slate-50">Never</span>}
                    {!d.active && <span className="ml-1 text-[9px] font-bold text-slate-400">(off)</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right whitespace-nowrap">
                    <button onClick={() => test(d)} disabled={testing === d.id} className="text-[11px] text-emerald-700 hover:underline mr-3 disabled:opacity-50">
                      {testing === d.id ? <Loader2 className="w-3 h-3 inline animate-spin" /> : 'Test'}
                    </button>
                    <button onClick={() => edit(d)} className="text-[11px] text-blue-600 hover:underline">Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

/** Derive a Code from a Name: uppercase, non-alphanum → underscore, dedupe & trim. */
function deriveCode(name: string): string {
  return (name || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function DeviceFormModal({ initial, onClose }: { initial: Partial<BiometricDevice>; onClose: () => void }) {
  const [d, setD] = useState<Partial<BiometricDevice>>(initial);
  const [codeManual, setCodeManual] = useState<boolean>(!!initial.id); // existing devices keep their code
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    const finalCode = (d.code && d.code.trim()) || deriveCode(d.name || '');
    if (!finalCode || !d.name || !d.ip) { setErr('Name and IP required'); return; }
    setSaving(true);
    try {
      const body = { ...d, code: finalCode };
      if (d.id) {
        await api.put(`/biometric/devices/${d.id}`, body);
      } else {
        await api.post('/biometric/devices', body);
      }
      onClose();
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  }

  // Live preview of the auto-derived code (shown when user hasn't typed one)
  const codePreview = !codeManual ? deriveCode(d.name || '') : '';

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl w-full max-w-lg">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest">{d.id ? 'Edit Device' : 'New Device'}</span>
          <button onClick={onClose}><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 grid grid-cols-2 gap-3">
          <Field label="Name">
            <input
              value={d.name || ''}
              onChange={e => setD({ ...d, name: e.target.value })}
              placeholder="Main Gate"
              className="w-full border border-slate-300 px-2.5 py-1.5 text-xs"
              autoFocus
            />
          </Field>
          <Field label={codeManual ? 'Code (A-Z, 0-9, _)' : 'Code (auto)'}>
            <input
              value={codeManual ? (d.code || '') : codePreview}
              onChange={e => { setCodeManual(true); setD({ ...d, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }); }}
              placeholder={codePreview || 'auto-generated from Name'}
              className={`w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono ${codeManual ? '' : 'bg-slate-50 text-slate-500'}`}
            />
          </Field>
          <Field label="Location"><input value={d.location || ''} onChange={e => setD({ ...d, location: e.target.value })} placeholder="Plant front entrance" className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" /></Field>
          <Field label="Active">
            <select value={d.active ? '1' : '0'} onChange={e => setD({ ...d, active: e.target.value === '1' })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs">
              <option value="1">Active</option>
              <option value="0">Inactive</option>
            </select>
          </Field>
          <Field label="IP Address"><input value={d.ip || ''} onChange={e => setD({ ...d, ip: e.target.value })} placeholder="192.168.0.25" className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
          <Field label="Port"><input type="number" value={d.port ?? 4370} onChange={e => setD({ ...d, port: parseInt(e.target.value) || 4370 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
          <Field label="Comm Password (0 = none)"><input type="number" value={d.password ?? 0} onChange={e => setD({ ...d, password: parseInt(e.target.value) || 0 })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" /></Field>
          <Field label="Notes"><input value={d.notes || ''} onChange={e => setD({ ...d, notes: e.target.value })} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs" /></Field>
          <div className="col-span-2 mt-2 pt-3 border-t border-slate-200">
            <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-2">Auto-Sync (minutes; 0 = manual only)</div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Auto Pull Punches">
                <input
                  type="number" min={0} max={1440}
                  value={d.autoPullMinutes ?? 0}
                  onChange={e => setD({ ...d, autoPullMinutes: parseInt(e.target.value) || 0 })}
                  placeholder="5"
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
                />
              </Field>
              <Field label="Auto Push Employees">
                <input
                  type="number" min={0} max={1440}
                  value={d.autoPushMinutes ?? 0}
                  onChange={e => setD({ ...d, autoPushMinutes: parseInt(e.target.value) || 0 })}
                  placeholder="60"
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono"
                />
              </Field>
            </div>
            <div className="text-[10px] text-slate-500 mt-1">
              Try <span className="font-mono">5</span> for testing,&nbsp;
              <span className="font-mono">60</span> (1 hr) or <span className="font-mono">240</span> (4 hr) for production.
            </div>
            {(d.lastAutoPullAt || d.lastAutoPushAt) && (
              <div className="text-[10px] text-slate-500 mt-2">
                {d.lastAutoPullAt && <>Last auto-pull: <span className="font-mono">{new Date(d.lastAutoPullAt).toLocaleString('en-IN')}</span><br /></>}
                {d.lastAutoPushAt && <>Last auto-push: <span className="font-mono">{new Date(d.lastAutoPushAt).toLocaleString('en-IN')}</span></>}
              </div>
            )}
          </div>
          {(d.serialNumber || d.firmware) && (
            <div className="col-span-2 text-[10px] text-slate-500 border-t border-slate-200 pt-2">
              Captured: serial <span className="font-mono">{d.serialNumber || '--'}</span> · firmware <span className="font-mono">{d.firmware || '--'}</span>
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

// ════════════════════════════════════════════════════════════════
// MAPPING TAB — pull users from device, side-by-side with ERP, confirm matches
// ════════════════════════════════════════════════════════════════

function MappingView({ devices }: { devices: BiometricDevice[] }) {
  const [deviceId, setDeviceId] = useState<string>(devices.find(d => d.active)?.id ?? '');
  const [data, setData] = useState<PullUsersResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [allEmployees, setAllEmployees] = useState<ERPEmpRef[]>([]);

  useEffect(() => { setDeviceId(devices.find(d => d.active)?.id ?? ''); }, [devices]);

  useEffect(() => {
    api.get('/employees?isActive=true').then(r => setAllEmployees((r.data?.employees || []).map((e: any) => ({
      id: e.id, empCode: e.empCode, empNo: e.empNo, firstName: e.firstName, lastName: e.lastName, deviceUserId: e.deviceUserId ?? null,
    }))));
  }, []);

  async function pull() {
    if (!deviceId) return;
    setLoading(true);
    try { const r = await api.post<PullUsersResp>(`/biometric/devices/${deviceId}/pull-users`, undefined, { timeout: 60_000 }); setData(r.data); }
    catch (e: any) { alert(e?.response?.data?.error || 'Pull failed'); }
    finally { setLoading(false); }
  }

  async function applySuggested() {
    if (!data || !deviceId) return;
    const matches = data.matched.filter(m => m.matchKind === 'NAME').map(m => ({
      employeeId: m.employee.id, deviceUserId: m.deviceUser.user_id,
    }));
    if (matches.length === 0) { alert('No new name-matches to apply'); return; }
    if (!confirm(`Apply ${matches.length} suggested mapping(s)?`)) return;
    const r = await api.post(`/biometric/devices/${deviceId}/apply-matches`, { matches });
    alert(`Applied ${r.data.applied}, errors: ${r.data.errors.length}`);
    pull();
  }

  async function setMapping(employeeId: string, deviceUserId: string) {
    try {
      await api.put(`/biometric/mapping/${employeeId}`, { deviceUserId });
      pull();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Failed');
    }
  }

  async function clearMapping(employeeId: string) {
    if (!confirm('Clear mapping?')) return;
    await api.put(`/biometric/mapping/${employeeId}`, { deviceUserId: null });
    pull();
  }

  /** Move a device user_id from one Employee to another in two atomic steps. */
  async function remap(currentEmployeeId: string, newEmployeeId: string, deviceUserId: string) {
    if (currentEmployeeId === newEmployeeId) return;
    try {
      // 1) Clear the current employee's deviceUserId so the new mapping doesn't collide
      await api.put(`/biometric/mapping/${currentEmployeeId}`, { deviceUserId: null });
      // 2) Set on new employee
      await api.put(`/biometric/mapping/${newEmployeeId}`, { deviceUserId });
      pull();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Remap failed');
      pull();
    }
  }

  /** Create new ERP Employees from a list of unmatched device users. */
  async function createEmployees(rows: UnmatchedRow[]) {
    if (!data || !deviceId || rows.length === 0) return;
    const entries = rows.map(r => ({
      deviceUserId: r.deviceUser.user_id,
      name: r.deviceUser.name,
      card: r.deviceUser.card || undefined,
    }));
    if (!confirm(`Create ${entries.length} new ERP Employee(s) from device data?\n\nEach will get a fresh empCode (MSPIL-NNN), today's joining date, and the device user_id mapping. Aadhaar/PAN/salary stay blank — fill later in HR > Employees.`)) return;
    try {
      const r = await api.post(`/biometric/devices/${deviceId}/create-employees`, { entries });
      alert(`✓ Created ${r.data.created} employees${r.data.skipped ? `, skipped ${r.data.skipped}` : ''}`);
      pull();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Create failed');
    }
  }

  /** Create LaborWorker rows from unmatched device users — opens modal to pick contractor + skill. */
  const [createLaborTarget, setCreateLaborTarget] = useState<UnmatchedRow[] | null>(null);

  return (
    <div>
      <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Device</label>
        <select value={deviceId} onChange={e => setDeviceId(e.target.value)} className="border border-slate-300 px-2.5 py-1 text-xs">
          <option value="">— Select —</option>
          {devices.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.code} ({d.ip})</option>)}
        </select>
        <button onClick={pull} disabled={!deviceId || loading} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50 inline-flex items-center gap-1">
          {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <DownloadCloud className="w-3 h-3" />} Pull Users
        </button>
        <div className="flex-1" />
        {data && (
          <>
            <span className="text-[10px] text-slate-500">
              <b className="text-emerald-700">{data.summary.matched}</b> matched ·{' '}
              <b className="text-amber-700">{data.summary.ambiguous}</b> ambiguous ·{' '}
              <b className="text-rose-700">{data.summary.unmatched}</b> unmatched
            </span>
            <button onClick={applySuggested} className="px-3 py-1 bg-emerald-600 text-white text-[11px] font-medium hover:bg-emerald-700 inline-flex items-center gap-1">
              <Check className="w-3 h-3" /> Apply Name Matches
            </button>
          </>
        )}
      </div>

      {/* Matched */}
      {data && data.matched.length > 0 && (
        <Section title="MATCHED" tone="emerald">
          <table className="w-full text-xs">
            <thead className="bg-slate-200 border-b border-slate-300">
              <tr>
                <Th>Device User ID</Th><Th>Device Name</Th><Th>→</Th>
                <Th>ERP Emp Code</Th><Th>ERP Name</Th><Th>Match Kind</Th><Th>Reassign To...</Th><Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {data.matched.map(m => {
                const free = allEmployees.filter(e => !e.deviceUserId && e.id !== m.employee.id);
                return (
                  <tr key={m.deviceUser.uid} className="border-b border-slate-100 even:bg-slate-50/70">
                    <Td mono>{m.deviceUser.user_id}</Td>
                    <Td>{m.deviceUser.name}</Td>
                    <Td className="text-emerald-600">→</Td>
                    <Td mono>{m.employee.empCode}</Td>
                    <Td>{m.employee.firstName} {m.employee.lastName}</Td>
                    <Td>
                      <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${m.matchKind === 'EXISTING' ? 'border-emerald-500 text-emerald-700 bg-emerald-50' : 'border-blue-500 text-blue-700 bg-blue-50'}`}>{m.matchKind}</span>
                    </Td>
                    <Td>
                      <select
                        onChange={e => e.target.value && remap(m.employee.id, e.target.value, m.deviceUser.user_id)}
                        defaultValue=""
                        className="border border-slate-300 px-2 py-0.5 text-[11px] max-w-[200px]"
                        title="Move this device user to a different ERP employee"
                      >
                        <option value="">— pick another —</option>
                        {free.map(c => <option key={c.id} value={c.id}>{c.empCode} — {c.firstName} {c.lastName}</option>)}
                      </select>
                    </Td>
                    <Td><button onClick={() => clearMapping(m.employee.id)} className="text-[11px] text-rose-600 hover:underline">Clear</button></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}

      {/* Ambiguous */}
      {data && data.ambiguous.length > 0 && (
        <Section title="AMBIGUOUS — pick one" tone="amber">
          <table className="w-full text-xs">
            <thead className="bg-slate-200 border-b border-slate-300">
              <tr><Th>Device User ID</Th><Th>Device Name</Th><Th>Candidates</Th></tr>
            </thead>
            <tbody>
              {data.ambiguous.map(a => (
                <tr key={a.deviceUser.uid} className="border-b border-slate-100">
                  <Td mono>{a.deviceUser.user_id}</Td>
                  <Td>{a.deviceUser.name}</Td>
                  <Td>
                    <select onChange={e => e.target.value && setMapping(e.target.value, a.deviceUser.user_id)} className="border border-slate-300 px-2 py-1 text-xs" defaultValue="">
                      <option value="">— Pick employee —</option>
                      {a.candidates.map(c => <option key={c.id} value={c.id}>{c.empCode} — {c.firstName} {c.lastName}</option>)}
                    </select>
                  </Td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Unmatched */}
      {data && data.unmatched.length > 0 && (
        <Section title="UNMATCHED — pick employee, create employee, or create as labor" tone="rose">
          <div className="px-3 py-2 bg-rose-50 border-b border-rose-200 flex items-center gap-3 flex-wrap">
            <span className="text-[10px] text-slate-600">
              {data.unmatched.length} device user(s) have no matching ERP record.
              Map to an existing employee, OR bulk-create as new employees, OR create as contractor labor.
            </span>
            <div className="flex-1" />
            <button
              onClick={() => createEmployees(data.unmatched)}
              className="px-3 py-1 bg-rose-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-rose-700 inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Create All as Employees ({data.unmatched.length})
            </button>
            <button
              onClick={() => setCreateLaborTarget(data.unmatched)}
              className="px-3 py-1 bg-amber-600 text-white text-[11px] font-bold uppercase tracking-widest hover:bg-amber-700 inline-flex items-center gap-1"
            >
              <Plus className="w-3 h-3" /> Create All as Labor ({data.unmatched.length})
            </button>
          </div>
          <table className="w-full text-xs">
            <thead className="bg-slate-200 border-b border-slate-300">
              <tr><Th>Device User ID</Th><Th>Device Name</Th><Th>Card</Th><Th>Map to ERP Employee</Th><Th>Or Create</Th></tr>
            </thead>
            <tbody>
              {data.unmatched.map(u => {
                const free = allEmployees.filter(e => !e.deviceUserId);
                return (
                  <tr key={u.deviceUser.uid} className="border-b border-slate-100">
                    <Td mono>{u.deviceUser.user_id}</Td>
                    <Td>{u.deviceUser.name}</Td>
                    <Td mono>{u.deviceUser.card || '--'}</Td>
                    <Td>
                      <select onChange={e => e.target.value && setMapping(e.target.value, u.deviceUser.user_id)} className="border border-slate-300 px-2 py-1 text-xs" defaultValue="">
                        <option value="">— Pick existing —</option>
                        {free.map(c => <option key={c.id} value={c.id}>{c.empCode} — {c.firstName} {c.lastName}</option>)}
                      </select>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <button
                        onClick={() => createEmployees([u])}
                        className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border border-rose-300 text-rose-600 hover:bg-rose-50 inline-flex items-center gap-1 mr-1"
                      >
                        <Plus className="w-3 h-3" /> Employee
                      </button>
                      <button
                        onClick={() => setCreateLaborTarget([u])}
                        className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest border border-amber-300 text-amber-700 hover:bg-amber-50 inline-flex items-center gap-1"
                      >
                        <Plus className="w-3 h-3" /> Labor
                      </button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Section>
      )}

      {createLaborTarget && (
        <CreateLaborModal
          rows={createLaborTarget}
          deviceId={deviceId}
          onClose={(created) => {
            setCreateLaborTarget(null);
            if (created) pull();
          }}
        />
      )}

      {!data && !loading && (
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white px-4 py-12 text-center text-xs text-slate-400 uppercase tracking-widest">
          Pick a device and click Pull Users
        </div>
      )}
    </div>
  );
}

function CreateLaborModal({ rows, deviceId, onClose }: { rows: UnmatchedRow[]; deviceId: string; onClose: (created: boolean) => void }) {
  const [contractors, setContractors] = useState<Array<{ id: string; name: string }>>([]);
  const [contractorId, setContractorId] = useState('');
  const [skillCategory, setSkillCategory] = useState<string>('UNSKILLED');
  const [dailyRate, setDailyRate] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.get('/contractors').then(r => {
      const list = r.data?.contractors || r.data || [];
      setContractors(list);
      if (list.length > 0) setContractorId(list[0].id);
    });
  }, []);

  async function save() {
    setErr(null);
    if (!contractorId) { setErr('Select a contractor'); return; }
    setSaving(true);
    try {
      const entries = rows.map(r => ({
        deviceUserId: r.deviceUser.user_id,
        name: r.deviceUser.name,
        card: r.deviceUser.card || undefined,
      }));
      const r = await api.post(`/biometric/devices/${deviceId}/create-labor-workers`, {
        contractorId,
        skillCategory: skillCategory || null,
        dailyRate: dailyRate ? parseFloat(dailyRate) : null,
        entries,
      });
      alert(`✓ Created ${r.data.created} labor worker(s)${r.data.skipped ? `, skipped ${r.data.skipped}` : ''}`);
      onClose(true);
    } catch (e: any) {
      setErr(e?.response?.data?.error || 'Failed');
    } finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white shadow-2xl w-full max-w-md">
        <div className="bg-slate-800 text-white px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest">Create as Labor — {rows.length} worker(s)</span>
          <button onClick={() => onClose(false)}><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-3">
          <div className="text-[11px] text-slate-600">
            All {rows.length} unmatched device user(s) will be created as <b>LaborWorker</b> rows under
            the chosen contractor with the chosen skill + rate. Names/cards come from the device.
          </div>
          <label className="block">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Contractor (labor supplier) *</span>
            <select value={contractorId} onChange={e => setContractorId(e.target.value)} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs">
              <option value="">— Select —</option>
              {contractors.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Skill Category (default for all)</span>
            <select value={skillCategory} onChange={e => setSkillCategory(e.target.value)} className="w-full border border-slate-300 px-2.5 py-1.5 text-xs">
              <option value="">— None —</option>
              <option value="UNSKILLED">UNSKILLED</option>
              <option value="SEMI_SKILLED">SEMI_SKILLED</option>
              <option value="SKILLED">SKILLED</option>
            </select>
          </label>
          <label className="block">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Daily Rate (₹) — optional</span>
            <input type="number" step="0.01" value={dailyRate} onChange={e => setDailyRate(e.target.value)} placeholder="350" className="w-full border border-slate-300 px-2.5 py-1.5 text-xs font-mono" />
          </label>
          {err && <div className="text-[11px] text-rose-600 border border-rose-200 bg-rose-50 px-2 py-1">{err}</div>}
        </div>
        <div className="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
          <button onClick={() => onClose(false)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={saving} className="px-3 py-1 bg-amber-600 text-white text-[11px] font-medium hover:bg-amber-700 disabled:opacity-50 inline-flex items-center gap-1">
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Create {rows.length} Labor
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ title, tone, children }: { title: string; tone: 'emerald' | 'amber' | 'rose'; children: React.ReactNode }) {
  const colors: Record<string, string> = {
    emerald: 'border-l-emerald-500 bg-emerald-50',
    amber: 'border-l-amber-500 bg-amber-50',
    rose: 'border-l-rose-500 bg-rose-50',
  };
  return (
    <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 mt-3">
      <div className={`px-4 py-2 border-b border-slate-300 border-l-4 ${colors[tone]}`}>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-700">{title}</span>
      </div>
      <div className="overflow-x-auto">{children}</div>
    </div>
  );
}

const Th = ({ children }: { children: React.ReactNode }) => (
  <th className="px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-100 text-left">{children}</th>
);
const Td = ({ children, mono = false, className = '' }: { children: React.ReactNode; mono?: boolean; className?: string }) => (
  <td className={`px-3 py-1.5 border-r border-slate-100 ${mono ? 'font-mono' : ''} ${className}`}>{children}</td>
);

// ════════════════════════════════════════════════════════════════
// SYNC OPS TAB — pull punches, push employees, sync time, replicate fingerprint
// ════════════════════════════════════════════════════════════════

function OpsView({ devices, reload }: { devices: BiometricDevice[]; reload: () => void }) {
  const [deviceId, setDeviceId] = useState<string>(devices.find(d => d.active)?.id ?? '');
  const [running, setRunning] = useState<string | null>(null);
  const [log, setLog] = useState<string>('');

  useEffect(() => { setDeviceId(devices.find(d => d.active)?.id ?? ''); }, [devices]);

  async function run(label: string, fn: () => Promise<any>) {
    setRunning(label);
    setLog(`→ ${label}...\n`);
    try {
      const r = await fn();
      setLog(prev => prev + JSON.stringify(r.data, null, 2) + '\n');
      reload();
    } catch (e: any) {
      setLog(prev => prev + `✗ ${e?.response?.data?.error || e?.message || 'Failed'}\n`);
    } finally { setRunning(null); }
  }

  return (
    <div>
      <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-2 -mx-3 md:-mx-6 flex items-center gap-3 flex-wrap">
        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Device</label>
        <select value={deviceId} onChange={e => setDeviceId(e.target.value)} className="border border-slate-300 px-2.5 py-1 text-xs">
          <option value="">— Select —</option>
          {devices.filter(d => d.active).map(d => <option key={d.id} value={d.id}>{d.code} ({d.ip})</option>)}
        </select>
      </div>

      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white p-4 space-y-3">
        <OpButton
          label="Pull Punches"
          icon={<DownloadCloud className="w-3.5 h-3.5" />}
          desc="Fetch new attendance logs since last sync; write AttendancePunch rows"
          disabled={!deviceId || running !== null}
          loading={running === 'pull-punches'}
          onClick={() => deviceId && run('pull-punches', () => api.post(`/biometric/devices/${deviceId}/pull-punches`, undefined, { timeout: 120_000 }))}
        />
        <OpButton
          label="Sync Employees → Device"
          icon={<UploadCloud className="w-3.5 h-3.5" />}
          desc="Push every active ERP employee (with deviceUserId) to the device user list"
          tone="amber"
          disabled={!deviceId || running !== null}
          loading={running === 'sync-employees'}
          onClick={() => deviceId && run('sync-employees', () => api.post(`/biometric/devices/${deviceId}/sync-employees`, undefined, { timeout: 180_000 }))}
        />
        <OpButton
          label="Sync Device Clock"
          icon={<Clock className="w-3.5 h-3.5" />}
          desc="Set device's clock to current IST"
          tone="indigo"
          disabled={!deviceId || running !== null}
          loading={running === 'sync-time'}
          onClick={() => deviceId && run('sync-time', () => api.post(`/biometric/devices/${deviceId}/sync-time`))}
        />
      </div>

      {log && (
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-900 text-emerald-300 p-4 font-mono text-[11px] whitespace-pre-wrap max-h-72 overflow-auto">
          {log}
        </div>
      )}
    </div>
  );
}

function OpButton({ label, desc, icon, tone = 'blue', disabled, loading, onClick }: { label: string; desc: string; icon: React.ReactNode; tone?: 'blue' | 'amber' | 'indigo' | 'rose'; disabled?: boolean; loading?: boolean; onClick: () => void }) {
  const colors: Record<string, string> = {
    blue: 'bg-blue-600 hover:bg-blue-700 border-l-blue-500',
    amber: 'bg-amber-600 hover:bg-amber-700 border-l-amber-500',
    indigo: 'bg-indigo-600 hover:bg-indigo-700 border-l-indigo-500',
    rose: 'bg-rose-600 hover:bg-rose-700 border-l-rose-500',
  };
  return (
    <div className={`flex items-center gap-3 border border-slate-200 border-l-4 ${colors[tone].split(' ')[2]} bg-white px-4 py-3`}>
      <div className="flex-1">
        <div className="text-xs font-bold uppercase tracking-widest text-slate-700">{label}</div>
        <div className="text-[11px] text-slate-500 mt-0.5">{desc}</div>
      </div>
      <button
        onClick={onClick}
        disabled={disabled}
        className={`px-3 py-1.5 text-white text-[11px] font-medium disabled:opacity-50 inline-flex items-center gap-1 ${colors[tone].split(' ')[0]} ${colors[tone].split(' ')[1]}`}
      >
        {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}
        Run
      </button>
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
