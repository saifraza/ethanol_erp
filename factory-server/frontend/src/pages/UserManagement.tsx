import { useState, useEffect, useCallback, Fragment } from 'react';
import axios from 'axios';
import { useAuth } from '../context/AuthContext';

interface FactoryUser {
  id: string;
  username: string;
  name: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

const ROLES = [
  { value: 'ADMIN', label: 'Admin', desc: 'Full access to all pages' },
  { value: 'GATE_ENTRY', label: 'Gate Entry', desc: 'Gate entry page only' },
  { value: 'WEIGHBRIDGE', label: 'Weighbridge', desc: 'Weighment monitoring only' },
  { value: 'FUEL_YARD', label: 'Fuel Yard', desc: 'Fuel intake tracking' },
  { value: 'LAB', label: 'Lab', desc: 'Lab data entry' },
];

const ROLE_COLORS: Record<string, string> = {
  ADMIN: 'border-purple-300 bg-purple-50 text-purple-700',
  GATE_ENTRY: 'border-green-300 bg-green-50 text-green-700',
  WEIGHBRIDGE: 'border-blue-300 bg-blue-50 text-blue-700',
  FUEL_YARD: 'border-orange-300 bg-orange-50 text-orange-700',
  LAB: 'border-cyan-300 bg-cyan-50 text-cyan-700',
};

export default function UserManagement() {
  const { token } = useAuth();
  const [users, setUsers] = useState<FactoryUser[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ username: '', password: '', name: '', roles: [] as string[] });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', roles: [] as string[], isActive: true, newPassword: '' });

  const api = axios.create({ baseURL: '/api', headers: { Authorization: `Bearer ${token}` } });

  const fetchUsers = useCallback(async () => {
    try {
      const res = await api.get('/auth/users');
      setUsers(res.data);
    } catch (err) { console.error(err); }
  }, [token]);

  useEffect(() => { fetchUsers(); }, [fetchUsers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);
    try {
      const role = form.roles.length === 0 ? 'GATE_ENTRY' : form.roles.join(',');
      await api.post('/auth/users', { username: form.username, password: form.password, name: form.name, role });
      setShowForm(false);
      setForm({ username: '', password: '', name: '', roles: [] });
      fetchUsers();
    } catch (err) {
      if (axios.isAxiosError(err) && err.response?.data?.error) {
        setError(err.response.data.error);
      } else {
        setError('Failed to create user');
      }
    } finally { setSaving(false); }
  };

  function startEdit(u: FactoryUser) {
    const roles = u.role.split(',').map(r => r.trim());
    setEditingId(u.id);
    setEditForm({ name: u.name, roles, isActive: u.isActive, newPassword: '' });
  }

  async function saveEdit() {
    if (!editingId) return;
    setSaving(true);
    try {
      const role = editForm.roles.length === 0 ? 'GATE_ENTRY' : editForm.roles.join(',');
      await api.put(`/auth/users/${editingId}`, { name: editForm.name, role, isActive: editForm.isActive });
      if (editForm.newPassword) {
        await api.put(`/auth/users/${editingId}/password`, { password: editForm.newPassword });
      }
      setEditingId(null);
      fetchUsers();
    } catch { alert('Failed to update user'); }
    finally { setSaving(false); }
  }

  return (
    <div className="p-3 md:p-6 space-y-0">
      {/* Toolbar */}
      <div className="bg-slate-800 text-white px-4 py-2.5 -mx-3 md:-mx-6 -mt-3 md:-mt-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-wide uppercase">Users</h1>
          <span className="text-[10px] text-slate-400">|</span>
          <span className="text-[10px] text-slate-400">Factory System Users</span>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="px-3 py-1 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700">
          {showForm ? 'Cancel' : '+ New User'}
        </button>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-3 gap-0 border-x border-b border-slate-300 -mx-3 md:-mx-6">
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-blue-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Total Users</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{users.length}</div>
        </div>
        <div className="bg-white px-4 py-3 border-r border-slate-300 border-l-4 border-l-green-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active</div>
          <div className="text-xl font-bold text-green-700 mt-1 font-mono tabular-nums">{users.filter(u => u.isActive).length}</div>
        </div>
        <div className="bg-white px-4 py-3 border-l-4 border-l-purple-500">
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Roles</div>
          <div className="text-xl font-bold text-slate-800 mt-1 font-mono tabular-nums">{new Set(users.map(u => u.role)).size}</div>
        </div>
      </div>

      {/* New User Form */}
      {showForm && (
        <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-white">
          <div className="bg-slate-200 px-4 py-1.5 border-b border-slate-300">
            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-widest">Create New User</span>
          </div>
          <form onSubmit={handleCreate} className="p-4 space-y-3">
            {error && (
              <div className="bg-red-50 border border-red-300 text-red-700 px-3 py-2 text-xs">{error}</div>
            )}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Username</label>
                <input value={form.username} onChange={e => setForm({ ...form, username: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="e.g. gate2" required />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Password</label>
                <input type="password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Min 4 chars" required />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Full Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Display name" required />
              </div>
              <div>
                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Roles (select multiple)</label>
                <div className="flex flex-wrap gap-2 mt-1">
                  {ROLES.map(r => (
                    <label key={r.value} className={`flex items-center gap-1.5 px-2 py-1 border cursor-pointer text-xs ${form.roles.includes(r.value) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-600'}`}>
                      <input type="checkbox" checked={form.roles.includes(r.value)}
                        onChange={e => {
                          if (r.value === 'ADMIN') {
                            setForm({ ...form, roles: e.target.checked ? ['ADMIN'] : [] });
                          } else {
                            const filtered = form.roles.filter(x => x !== 'ADMIN' && x !== r.value);
                            setForm({ ...form, roles: e.target.checked ? [...filtered, r.value] : filtered });
                          }
                        }}
                        className="w-3 h-3" />
                      {r.label}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex gap-2">
              <button type="submit" disabled={saving} className="px-4 py-1.5 bg-blue-600 text-white text-[11px] font-medium hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create User'}
              </button>
              <button type="button" onClick={() => { setShowForm(false); setError(''); }} className="px-4 py-1.5 bg-white border border-slate-300 text-slate-600 text-[11px] font-medium hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Role Legend */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 bg-slate-50 px-4 py-2 flex gap-4 flex-wrap">
        {ROLES.map(r => (
          <div key={r.value} className="flex items-center gap-1.5">
            <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${ROLE_COLORS[r.value] || 'border-slate-300 text-slate-500'}`}>{r.label}</span>
            <span className="text-[10px] text-slate-500">{r.desc}</span>
          </div>
        ))}
      </div>

      {/* Users Table */}
      <div className="-mx-3 md:-mx-6 border-x border-b border-slate-300 overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-slate-800 text-white">
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Username</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Name</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Role</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Active</th>
              <th className="text-left px-3 py-2 font-semibold text-[10px] uppercase tracking-widest border-r border-slate-700">Created</th>
              <th className="text-center px-3 py-2 font-semibold text-[10px] uppercase tracking-widest">Action</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => (
              <Fragment key={u.id}>
              <tr className={`border-b border-slate-100 hover:bg-blue-50/60 ${i % 2 ? 'bg-slate-50/70' : ''}`}>
                <td className="px-3 py-1.5 text-slate-800 font-mono font-bold border-r border-slate-100">{u.username}</td>
                <td className="px-3 py-1.5 text-slate-700 border-r border-slate-100">{u.name}</td>
                <td className="px-3 py-1.5 border-r border-slate-100">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${ROLE_COLORS[u.role] || 'border-slate-300 bg-slate-50 text-slate-500'}`}>
                    {u.role.replace(/_/g, ' ')}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-center border-r border-slate-100">
                  <span className={`text-[9px] font-bold uppercase px-1.5 py-0.5 border ${u.isActive ? 'border-green-300 bg-green-50 text-green-700' : 'border-red-300 bg-red-50 text-red-700'}`}>
                    {u.isActive ? 'YES' : 'NO'}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-slate-500 font-mono border-r border-slate-100">
                  {new Date(u.createdAt).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                </td>
                <td className="px-3 py-1.5 text-center">
                  <button onClick={() => startEdit(u)} className="px-2 py-0.5 bg-blue-600 text-white text-[10px] font-bold uppercase hover:bg-blue-700">
                    Edit
                  </button>
                </td>
              </tr>
              {editingId === u.id && (
                <tr className="bg-blue-50 border-b border-blue-200">
                  <td colSpan={6} className="px-3 py-3">
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Name</label>
                        <input value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                          className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">New Password (optional)</label>
                        <input type="password" value={editForm.newPassword} onChange={e => setEditForm({ ...editForm, newPassword: e.target.value })}
                          className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-slate-400" placeholder="Leave empty to keep" />
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Active</label>
                        <select value={editForm.isActive ? 'true' : 'false'} onChange={e => setEditForm({ ...editForm, isActive: e.target.value === 'true' })}
                          className="w-full border border-slate-300 px-2.5 py-1.5 text-xs focus:outline-none">
                          <option value="true">Active</option>
                          <option value="false">Disabled</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block mb-0.5">Roles</label>
                        <div className="flex flex-wrap gap-1 mt-0.5">
                          {ROLES.map(r => (
                            <label key={r.value} className={`flex items-center gap-1 px-1.5 py-0.5 border cursor-pointer text-[10px] ${editForm.roles.includes(r.value) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-slate-300 bg-white text-slate-500'}`}>
                              <input type="checkbox" checked={editForm.roles.includes(r.value)}
                                onChange={e => {
                                  if (r.value === 'ADMIN') {
                                    setEditForm({ ...editForm, roles: e.target.checked ? ['ADMIN'] : [] });
                                  } else {
                                    const filtered = editForm.roles.filter(x => x !== 'ADMIN' && x !== r.value);
                                    setEditForm({ ...editForm, roles: e.target.checked ? [...filtered, r.value] : filtered });
                                  }
                                }}
                                className="w-2.5 h-2.5" />
                              {r.label}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-2 mt-2">
                      <button onClick={saveEdit} disabled={saving} className="px-3 py-1 bg-green-600 text-white text-[10px] font-bold uppercase hover:bg-green-700 disabled:opacity-50">
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                      <button onClick={() => setEditingId(null)} className="px-3 py-1 bg-white border border-slate-300 text-slate-600 text-[10px] font-bold uppercase hover:bg-slate-50">
                        Cancel
                      </button>
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
