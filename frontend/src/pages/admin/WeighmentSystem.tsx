import React, { useState, useEffect, useCallback } from 'react';
import api from '../../services/api';

interface PCStatus {
  pcId: string;
  pcName: string;
  timestamp: string;
  receivedAt: string;
  isAlive: boolean;
  lastSeenSec: number;
  uptimeSeconds?: number;
  queueDepth?: number;
  dbSizeMb?: number;
  serialConnected?: boolean;
  serialProtocol?: string;
  webPort?: number;
  tailscaleIp?: string;
  system?: {
    cpuPercent?: number;
    memoryMb?: number;
    diskFreeGb?: number;
    hostname?: string;
    os?: string;
  };
  localUrl?: string;
  weightsToday?: number;
  lastTicket?: number;
  version?: string;
}

interface SystemStatus {
  pcs: PCStatus[];
  totalPCs: number;
  alivePCs: number;
  totalSynced: number;
  todaySynced: number;
}

interface FactoryUser {
  id: string;
  username: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

type FactoryRole = 'ADMIN' | 'GATE_ENTRY' | 'WEIGHBRIDGE' | 'FUEL_YARD' | 'LAB';

const ROLES: FactoryRole[] = ['ADMIN', 'GATE_ENTRY', 'WEIGHBRIDGE', 'FUEL_YARD', 'LAB'];

const ROLE_COLORS: Record<FactoryRole, string> = {
  ADMIN: 'border-purple-300 bg-purple-50 text-purple-700',
  GATE_ENTRY: 'border-green-300 bg-green-50 text-green-700',
  WEIGHBRIDGE: 'border-blue-300 bg-blue-50 text-blue-700',
  FUEL_YARD: 'border-orange-300 bg-orange-50 text-orange-700',
  LAB: 'border-cyan-300 bg-cyan-50 text-cyan-700',
};

export default function WeighmentSystem() {
  const [activeTab, setActiveTab] = useState<'status' | 'users'>('status');
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  // Factory Users state
  const [users, setUsers] = useState<FactoryUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [usersError, setUsersError] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [createForm, setCreateForm] = useState({ username: '', password: '', name: '', role: 'GATE_ENTRY' as FactoryRole });
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', role: '' as FactoryRole, isActive: true, password: '' });
  const [saving, setSaving] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await api.get<SystemStatus>('/weighbridge/system-status');
      setStatus(res.data);
    } catch (err) { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  const fetchUsers = useCallback(async () => {
    try {
      setUsersLoading(true);
      setUsersError(false);
      const res = await api.get<FactoryUser[]>('/weighbridge/factory-users');
      setUsers(res.data);
    } catch {
      setUsersError(true);
      setUsers([]);
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    if (activeTab === 'users') fetchUsers();
  }, [activeTab, fetchUsers]);

  const formatUptime = (sec: number) => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    if (h > 24) return `${Math.floor(h / 24)}d ${h % 24}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  };

  const formatLastSeen = (sec: number) => {
    if (sec < 60) return `${sec}s ago`;
    if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
    return `${Math.floor(sec / 3600)}h ago`;
  };

  const handleCreateUser = async () => {
    if (!createForm.username || !createForm.password || !createForm.name) return;
    try {
      setCreating(true);
      await api.post('/weighbridge/factory-users', createForm);
      setCreateForm({ username: '', password: '', name: '', role: 'GATE_ENTRY' });
      setShowCreateForm(false);
      fetchUsers();
    } catch (err) {
      /* ignore */
    } finally {
      setCreating(false);
    }
  };

  const handleStartEdit = (user: FactoryUser) => {
    setEditingId(user.id);
    setEditForm({ name: user.name, role: user.role as FactoryRole, isActive: user.isActive, password: '' });
  };

  const handleSaveEdit = async (userId: string) => {
    try {
      setSaving(true);
      await api.put(`/weighbridge/factory-users/${userId}`, {
        name: editForm.name,
        role: editForm.role,
        isActive: editForm.isActive,
      });
      if (editForm.password) {
        await api.put(`/weighbridge/factory-users/${userId}/password`, { password: editForm.password });
      }
      setEditingId(null);
      fetchUsers();
    } catch {
      /* ignore */
    } finally {
      setSaving(false);
    }
  };

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  };

  const uniqueRoles = new Set(users.map(u => u.role));

  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-xs text-slate-400 uppercase tracking-widest">Loading...</div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="p-3 md:p-6 space-y-0">
        {/* Toolbar */}
        <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold tracking-wide uppercase">Factory Linkage</h1>
            <span className="text-[10px] text-slate-400">|</span>
            <span className="text-[10px] text-slate-400">Factory PCs, Users & Sync Status</span>
          </div>
          <div className="flex items-center gap-2">
            {activeTab === 'users' && (
              <button
                onClick={() => { setShowCreateForm(!showCreateForm); setEditingId(null); }}
                className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700"
              >
                + New User
              </button>
            )}
            {activeTab === 'status' && (
              <button onClick={fetchStatus} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
                Refresh
              </button>
            )}
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-white">
          <button
            onClick={() => setActiveTab('status')}
            className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 ${
              activeTab === 'status'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            System Status
          </button>
          <button
            onClick={() => setActiveTab('users')}
            className={`px-4 py-2 text-[11px] font-bold uppercase tracking-widest border-b-2 ${
              activeTab === 'users'
                ? 'border-blue-600 text-blue-700'
                : 'border-transparent text-slate-400 hover:text-slate-600'
            }`}
          >
            Factory Users
          </button>
        </div>

        {activeTab === 'status' && (
          <>
            {/* KPI Strip */}
            <div className="grid grid-cols-4 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total PCs</div>
                <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{status?.totalPCs || 0}</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Online</div>
                <div className="text-xl font-bold text-green-600 mt-1 font-mono tabular-nums">{status?.alivePCs || 0}</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-orange-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Synced Today</div>
                <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{status?.todaySynced || 0}</div>
              </div>
              <div className="bg-white px-4 py-3 border-l-4 border-l-purple-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Synced</div>
                <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{status?.totalSynced || 0}</div>
              </div>
            </div>

            {/* PC Cards */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-800 text-white">
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Status</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">PC Name</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Last Seen</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Uptime</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Serial</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Queue</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">DB Size</th>
                    <th className="text-right px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Today</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Version</th>
                    <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Local UI</th>
                  </tr>
                </thead>
                <tbody>
                  {(!status?.pcs || status.pcs.length === 0) ? (
                    <tr><td colSpan={10} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No PCs have sent a heartbeat yet. Waiting for factory PCs to connect...</td></tr>
                  ) : status.pcs.map((pc, i) => (
                    <React.Fragment key={pc.pcId}>
                    <tr className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                      <td className="px-3 py-2 border-r border-slate-100">
                        {pc.isAlive ? (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700">Online</span>
                        ) : (
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-red-300 bg-red-50 text-red-700">Offline</span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-semibold text-slate-800 border-r border-slate-100">
                        <div>{pc.pcName}</div>
                        <div className="text-[9px] text-slate-400 font-mono">{pc.pcId}</div>
                      </td>
                      <td className="px-3 py-2 border-r border-slate-100">
                        <span className={`text-xs ${pc.isAlive ? 'text-green-600' : 'text-red-500'}`}>
                          {formatLastSeen(pc.lastSeenSec)}
                        </span>
                      </td>
                      <td className="px-3 py-2 font-mono tabular-nums border-r border-slate-100">
                        {pc.uptimeSeconds ? formatUptime(pc.uptimeSeconds) : '--'}
                      </td>
                      <td className="px-3 py-2 border-r border-slate-100">
                        <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${
                          pc.serialProtocol === 'serial' ? 'border-green-300 bg-green-50 text-green-700' :
                          pc.serialProtocol === 'file' ? 'border-blue-300 bg-blue-50 text-blue-700' :
                          'border-slate-300 bg-slate-50 text-slate-600'
                        }`}>{pc.serialProtocol || '?'}</span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums border-r border-slate-100">
                        <span className={pc.queueDepth && pc.queueDepth > 0 ? 'text-orange-600 font-bold' : 'text-slate-500'}>
                          {pc.queueDepth ?? '--'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-slate-500 border-r border-slate-100">
                        {pc.dbSizeMb ? `${pc.dbSizeMb} MB` : '--'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums font-bold text-slate-800 border-r border-slate-100">
                        {pc.weightsToday ?? '--'}
                      </td>
                      <td className="px-3 py-2 font-mono text-slate-500 border-r border-slate-100">
                        {pc.version || '--'}
                      </td>
                      <td className="px-3 py-2">
                        {pc.tailscaleIp || pc.localUrl ? (
                          <a href={`http://${pc.tailscaleIp || 'localhost'}:${pc.webPort || 8098}`}
                            target="_blank" rel="noreferrer"
                            className="text-[10px] text-blue-600 font-semibold uppercase hover:underline">
                            Open UI
                          </a>
                        ) : '--'}
                      </td>
                    </tr>
                    {/* System info row */}
                    {pc.system && (
                      <tr className="border-b border-slate-200 bg-slate-50/30">
                        <td colSpan={10} className="px-3 py-1.5 text-[10px] text-slate-500">
                          <span className="font-semibold text-slate-400 uppercase tracking-widest mr-4">System</span>
                          {pc.system.hostname && <span className="mr-4">Host: <span className="font-mono text-slate-700">{pc.system.hostname}</span></span>}
                          {pc.system.os && <span className="mr-4">OS: <span className="font-mono">{pc.system.os}</span></span>}
                          {pc.system.cpuPercent !== undefined && <span className="mr-4">CPU: <span className={`font-mono font-bold ${(pc.system.cpuPercent || 0) > 80 ? 'text-red-600' : 'text-slate-700'}`}>{pc.system.cpuPercent}%</span></span>}
                          {pc.system.memoryMb !== undefined && <span className="mr-4">RAM: <span className="font-mono text-slate-700">{Math.round((pc.system.memoryMb || 0) / 1024 * 10) / 10} GB</span></span>}
                          {pc.system.diskFreeGb !== undefined && <span className="mr-4">Disk Free: <span className={`font-mono font-bold ${(pc.system.diskFreeGb || 0) < 5 ? 'text-red-600' : 'text-slate-700'}`}>{pc.system.diskFreeGb} GB</span></span>}
                          {pc.tailscaleIp && <span>Tailscale: <span className="font-mono text-slate-700">{pc.tailscaleIp}</span></span>}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                  ))}

                  {/* Static entries for known PCs that haven't sent heartbeat */}
                  {(!status?.pcs || !status.pcs.find(p => p.pcId === 'opc-bridge')) && (
                    <tr className="border-b border-slate-100 bg-slate-50/70">
                      <td className="px-3 py-2 border-r border-slate-100">
                        <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-slate-300 bg-slate-50 text-slate-500">Unknown</span>
                      </td>
                      <td className="px-3 py-2 text-slate-400 border-r border-slate-100">
                        <div>Lab Computer (OPC)</div>
                        <div className="text-[9px] font-mono">100.74.209.72</div>
                      </td>
                      <td colSpan={8} className="px-3 py-2 text-xs text-slate-400 italic">OPC Bridge — separate heartbeat via /api/opc/heartbeat</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Info section */}
            <div className="bg-slate-100 border-x border-b border-slate-300 px-4 py-3 -mx-3 md:-mx-6">
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Factory Network</div>
              <div className="grid grid-cols-3 gap-4 text-xs text-slate-600">
                <div>
                  <div className="font-semibold">Weighbridge PC</div>
                  <div className="text-slate-400 font-mono">100.91.152.57 (Tailscale)</div>
                  <div className="text-slate-400">ethanolwb | User: abc</div>
                </div>
                <div>
                  <div className="font-semibold">Lab Computer (OPC)</div>
                  <div className="text-slate-400 font-mono">100.74.209.72 (Tailscale)</div>
                  <div className="text-slate-400">ethanollab</div>
                </div>
                <div>
                  <div className="font-semibold">Factory Server</div>
                  <div className="text-slate-400 font-mono">192.168.0.10 (LAN only)</div>
                  <div className="text-slate-400">Oracle XE | SSH pending</div>
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'users' && (
          <>
            {/* Users KPI Strip */}
            <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Users</div>
                <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{users.length}</div>
              </div>
              <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active</div>
                <div className="text-xl font-bold text-green-600 mt-1 font-mono tabular-nums">{users.filter(u => u.isActive).length}</div>
              </div>
              <div className="bg-white px-4 py-3 border-l-4 border-l-purple-500">
                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Roles</div>
                <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{uniqueRoles.size}</div>
              </div>
            </div>

            {/* Create User Form */}
            {showCreateForm && (
              <div className="border-x border-b border-slate-300 -mx-3 md:-mx-6 bg-blue-50/40 px-4 py-3">
                <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Create Factory User</div>
                <div className="flex items-end gap-3 flex-wrap">
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Username</label>
                    <input
                      type="text"
                      value={createForm.username}
                      onChange={e => setCreateForm(f => ({ ...f, username: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-36"
                      placeholder="e.g. ravi_gate"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Password</label>
                    <input
                      type="password"
                      value={createForm.password}
                      onChange={e => setCreateForm(f => ({ ...f, password: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-32"
                      placeholder="Min 4 chars"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Full Name</label>
                    <input
                      type="text"
                      value={createForm.name}
                      onChange={e => setCreateForm(f => ({ ...f, name: e.target.value }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-40"
                      placeholder="Operator name"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Role</label>
                    <select
                      value={createForm.role}
                      onChange={e => setCreateForm(f => ({ ...f, role: e.target.value as FactoryRole }))}
                      className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                    >
                      {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                    </select>
                  </div>
                  <button
                    onClick={handleCreateUser}
                    disabled={creating || !createForm.username || !createForm.password || !createForm.name}
                    className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                  >
                    {creating ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Users Table */}
            <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
              {usersLoading ? (
                <div className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">Loading factory users...</div>
              ) : usersError ? (
                <div className="px-4 py-6 text-center">
                  <div className="text-xs text-red-500 font-semibold uppercase tracking-widest mb-1">Factory server unreachable</div>
                  <div className="text-[11px] text-slate-400">Connect via Tailscale to manage factory user accounts</div>
                </div>
              ) : (
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white">
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Username</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Role</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Active</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Created</th>
                      <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.length === 0 ? (
                      <tr><td colSpan={6} className="px-3 py-8 text-center text-xs text-slate-400 uppercase tracking-widest">No factory users found. Click "+ New User" to create one.</td></tr>
                    ) : users.map((user, i) => (
                      <React.Fragment key={user.id}>
                        <tr className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                          <td className="px-3 py-2 font-mono font-semibold text-slate-800 border-r border-slate-100">{user.username}</td>
                          <td className="px-3 py-2 text-slate-700 border-r border-slate-100">{user.name}</td>
                          <td className="px-3 py-2 border-r border-slate-100">
                            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${ROLE_COLORS[user.role as FactoryRole] || 'border-slate-300 bg-slate-50 text-slate-600'}`}>
                              {user.role.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-3 py-2 border-r border-slate-100">
                            {user.isActive ? (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-green-300 bg-green-50 text-green-700">Yes</span>
                            ) : (
                              <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 border border-red-300 bg-red-50 text-red-700">No</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-slate-500 border-r border-slate-100">{formatDate(user.createdAt)}</td>
                          <td className="px-3 py-2">
                            <button
                              onClick={() => editingId === user.id ? setEditingId(null) : handleStartEdit(user)}
                              className="text-[10px] text-blue-600 font-semibold uppercase hover:underline"
                            >
                              {editingId === user.id ? 'Cancel' : 'Edit'}
                            </button>
                          </td>
                        </tr>
                        {editingId === user.id && (
                          <tr className="border-b border-slate-200 bg-blue-50/30">
                            <td colSpan={6} className="px-3 py-3">
                              <div className="flex items-end gap-3 flex-wrap">
                                <div>
                                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Name</label>
                                  <input
                                    type="text"
                                    value={editForm.name}
                                    onChange={e => setEditForm(f => ({ ...f, name: e.target.value }))}
                                    className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-40"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">New Password</label>
                                  <input
                                    type="password"
                                    value={editForm.password}
                                    onChange={e => setEditForm(f => ({ ...f, password: e.target.value }))}
                                    className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400 w-32"
                                    placeholder="Leave blank to keep"
                                  />
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Role</label>
                                  <select
                                    value={editForm.role}
                                    onChange={e => setEditForm(f => ({ ...f, role: e.target.value as FactoryRole }))}
                                    className="border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400"
                                  >
                                    {ROLES.map(r => <option key={r} value={r}>{r.replace('_', ' ')}</option>)}
                                  </select>
                                </div>
                                <div>
                                  <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-0.5 block">Active</label>
                                  <button
                                    onClick={() => setEditForm(f => ({ ...f, isActive: !f.isActive }))}
                                    className={`px-3 py-1.5 text-[11px] font-bold uppercase border ${
                                      editForm.isActive
                                        ? 'border-green-300 bg-green-50 text-green-700'
                                        : 'border-red-300 bg-red-50 text-red-700'
                                    }`}
                                  >
                                    {editForm.isActive ? 'Yes' : 'No'}
                                  </button>
                                </div>
                                <button
                                  onClick={() => handleSaveEdit(user.id)}
                                  disabled={saving || !editForm.name}
                                  className="px-3 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50"
                                >
                                  {saving ? 'Saving...' : 'Save'}
                                </button>
                                <button
                                  onClick={() => setEditingId(null)}
                                  className="px-3 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50"
                                >
                                  Cancel
                                </button>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
