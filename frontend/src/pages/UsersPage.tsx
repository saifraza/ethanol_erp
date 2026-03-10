import React, { useEffect, useState } from 'react';
import api from '../services/api';
import { UserPlus, Shield, Trash2, Pencil, Key, Save, X, Check } from 'lucide-react';

import { ALL_MODULES } from '../config/modules';

function parseModules(str: string | null | undefined): string[] {
  if (!str) return [];
  return str.split(',').filter(Boolean);
}

function modulesToString(arr: string[]): string | null {
  return arr.length > 0 ? arr.join(',') : null;
}

export default function UsersPage() {
  const [users, setUsers] = useState<any[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'OPERATOR', modules: [] as string[] });
  const [msg, setMsg] = useState({ text: '', type: '' });

  // Editing states
  const [editingModulesId, setEditingModulesId] = useState<string | null>(null);
  const [editModules, setEditModules] = useState<string[]>([]);
  const [editingNameId, setEditingNameId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [changingPwdId, setChangingPwdId] = useState<string | null>(null);
  const [newPwd, setNewPwd] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = () => api.get('/users').then(r => setUsers(r.data));
  useEffect(() => { load(); }, []);

  const flash = (text: string, type = 'success') => {
    setMsg({ text, type });
    setTimeout(() => setMsg({ text: '', type: '' }), 3000);
  };

  const toggleFormModule = (key: string) => {
    setForm(f => ({ ...f, modules: f.modules.includes(key) ? f.modules.filter(m => m !== key) : [...f.modules, key] }));
  };

  const addUser = async () => {
    if (!form.name || !form.email || !form.password) { flash('Fill all fields', 'error'); return; }
    try {
      await api.post('/users', {
        name: form.name, email: form.email, password: form.password, role: form.role,
        allowedModules: form.role === 'ADMIN' ? null : modulesToString(form.modules),
      });
      flash('User created!');
      setShowAdd(false);
      setForm({ name: '', email: '', password: '', role: 'OPERATOR', modules: [] });
      load();
    } catch (err: any) { flash(err.response?.data?.error || 'Error', 'error'); }
  };

  const toggleActive = async (id: string, isActive: boolean) => {
    await api.put(`/users/${id}`, { isActive: !isActive }); load();
  };

  const changeRole = async (id: string, role: string) => {
    await api.put(`/users/${id}`, { role, allowedModules: role === 'ADMIN' ? null : undefined }); load();
  };

  const startEditModules = (u: any) => { setEditingModulesId(u.id); setEditModules(parseModules(u.allowedModules)); };
  const toggleEditModule = (key: string) => setEditModules(m => m.includes(key) ? m.filter(x => x !== key) : [...m, key]);
  const saveModules = async (id: string) => {
    await api.put(`/users/${id}`, { allowedModules: modulesToString(editModules) });
    setEditingModulesId(null); flash('Modules updated!'); load();
  };

  const startEditName = (u: any) => { setEditingNameId(u.id); setEditName(u.name); };
  const saveName = async (id: string) => {
    if (!editName.trim()) return;
    await api.put(`/users/${id}`, { name: editName.trim() });
    setEditingNameId(null); flash('Name updated!'); load();
  };

  const savePassword = async (id: string) => {
    if (newPwd.length < 4) { flash('Min 4 characters', 'error'); return; }
    try {
      await api.put(`/users/${id}/password`, { password: newPwd });
      setChangingPwdId(null); setNewPwd(''); flash('Password changed!');
    } catch (err: any) { flash(err.response?.data?.error || 'Error', 'error'); }
  };

  const deleteUser = async (id: string) => {
    try {
      await api.delete(`/users/${id}`);
      setConfirmDelete(null); flash('User deleted!'); load();
    } catch (err: any) { flash(err.response?.data?.error || 'Error', 'error'); }
  };

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">User Management</h1>
        <button onClick={() => setShowAdd(!showAdd)} className="flex items-center gap-2 bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">
          <UserPlus size={16} />{showAdd ? 'Cancel' : 'Add User'}
        </button>
      </div>

      {msg.text && (
        <div className={`mb-4 p-3 rounded-lg text-sm flex items-center justify-between ${msg.type === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-green-50 text-green-700 border border-green-200'}`}>
          {msg.text}
          <button onClick={() => setMsg({ text: '', type: '' })}><X size={14} /></button>
        </div>
      )}

      {/* Add User Form */}
      {showAdd && (
        <div className="bg-white border rounded-xl p-5 mb-5 shadow-sm">
          <h3 className="font-semibold text-gray-700 mb-3">New User</h3>
          <div className="grid grid-cols-2 gap-3 mb-4">
            <input placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Password" type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm" />
            <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="border rounded-lg px-3 py-2 text-sm">
              <option value="OPERATOR">Operator</option>
              <option value="SUPERVISOR">Supervisor</option>
              <option value="ADMIN">Admin</option>
            </select>
          </div>

          {form.role !== 'ADMIN' && (
            <div className="mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-medium text-gray-600 flex items-center gap-1"><Shield size={14} /> Module Access</span>
                <div className="flex gap-2">
                  <button onClick={() => setForm(f => ({ ...f, modules: ALL_MODULES.map(m => m.key) }))} className="text-xs text-blue-600 hover:underline">Select All</button>
                  <button onClick={() => setForm(f => ({ ...f, modules: [] }))} className="text-xs text-red-500 hover:underline">Clear</button>
                </div>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {ALL_MODULES.map(m => (
                  <label key={m.key} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-sm cursor-pointer transition ${form.modules.includes(m.key) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                    <input type="checkbox" checked={form.modules.includes(m.key)} onChange={() => toggleFormModule(m.key)} className="rounded" />
                    {m.label}
                  </label>
                ))}
              </div>
              {form.modules.length === 0 && <p className="text-xs text-amber-600 mt-1">No modules selected — user won't see any pages</p>}
            </div>
          )}
          {form.role === 'ADMIN' && <p className="text-xs text-gray-500 mb-3">Admins have access to all modules</p>}
          <button onClick={addUser} className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-medium hover:bg-blue-700">Create User</button>
        </div>
      )}

      {/* User List */}
      <div className="space-y-3">
        {users.map(u => (
          <div key={u.id} className={`bg-white border rounded-xl p-4 shadow-sm ${!u.isActive ? 'opacity-60' : ''}`}>
            {/* Header row */}
            <div className="flex items-center justify-between">
              <div className="flex-1">
                {editingNameId === u.id ? (
                  <div className="flex items-center gap-2">
                    <input value={editName} onChange={e => setEditName(e.target.value)} className="border rounded px-2 py-1 text-sm font-semibold" autoFocus
                      onKeyDown={e => e.key === 'Enter' && saveName(u.id)} />
                    <button onClick={() => saveName(u.id)} className="text-green-600 hover:text-green-800"><Check size={16} /></button>
                    <button onClick={() => setEditingNameId(null)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-gray-800">{u.name}</span>
                    <button onClick={() => startEditName(u)} className="text-gray-400 hover:text-blue-600" title="Edit name"><Pencil size={13} /></button>
                  </div>
                )}
                <div className="text-xs text-gray-500">{u.email}</div>
              </div>

              <div className="flex items-center gap-3">
                <select value={u.role} onChange={e => changeRole(u.id, e.target.value)} className="text-xs border rounded px-2 py-1">
                  <option value="OPERATOR">Operator</option>
                  <option value="SUPERVISOR">Supervisor</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <span className={`px-2 py-0.5 text-xs rounded-full font-medium ${u.isActive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600'}`}>
                  {u.isActive ? 'Active' : 'Inactive'}
                </span>
                <button onClick={() => toggleActive(u.id, u.isActive)} className="text-xs text-blue-600 hover:underline">
                  {u.isActive ? 'Deactivate' : 'Activate'}
                </button>
                <button onClick={() => setChangingPwdId(changingPwdId === u.id ? null : u.id)} className="text-gray-400 hover:text-amber-600" title="Change password"><Key size={15} /></button>
                {confirmDelete === u.id ? (
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-red-600">Sure?</span>
                    <button onClick={() => deleteUser(u.id)} className="text-xs bg-red-600 text-white px-2 py-0.5 rounded hover:bg-red-700">Yes</button>
                    <button onClick={() => setConfirmDelete(null)} className="text-xs text-gray-500 hover:underline">No</button>
                  </div>
                ) : (
                  <button onClick={() => setConfirmDelete(u.id)} className="text-red-400 hover:text-red-600" title="Delete user"><Trash2 size={15} /></button>
                )}
              </div>
            </div>

            {/* Change password */}
            {changingPwdId === u.id && (
              <div className="mt-3 pt-3 border-t flex items-center gap-2">
                <input type="password" placeholder="New password (min 4 chars)" value={newPwd} onChange={e => setNewPwd(e.target.value)}
                  className="border rounded px-3 py-1.5 text-sm flex-1" onKeyDown={e => e.key === 'Enter' && savePassword(u.id)} />
                <button onClick={() => savePassword(u.id)} className="bg-amber-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-amber-700">Change</button>
                <button onClick={() => { setChangingPwdId(null); setNewPwd(''); }} className="text-xs text-gray-500 hover:underline">Cancel</button>
              </div>
            )}

            {/* Module permissions for non-admin */}
            {u.role !== 'ADMIN' && (
              <div className="mt-3 pt-3 border-t">
                {editingModulesId === u.id ? (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-medium text-gray-500">Edit Module Access</span>
                      <div className="flex gap-2">
                        <button onClick={() => setEditModules(ALL_MODULES.map(m => m.key))} className="text-xs text-blue-600 hover:underline">All</button>
                        <button onClick={() => setEditModules([])} className="text-xs text-red-500 hover:underline">None</button>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mb-3">
                      {ALL_MODULES.map(m => (
                        <label key={m.key} className={`flex items-center gap-2 px-2 py-1 rounded border text-xs cursor-pointer ${editModules.includes(m.key) ? 'bg-blue-50 border-blue-300 text-blue-700' : 'bg-white border-gray-200 text-gray-500'}`}>
                          <input type="checkbox" checked={editModules.includes(m.key)} onChange={() => toggleEditModule(m.key)} className="rounded" />
                          {m.label}
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => saveModules(u.id)} className="flex items-center gap-1 bg-blue-600 text-white px-3 py-1.5 rounded text-xs font-medium hover:bg-blue-700">
                        <Save size={12} /> Save
                      </button>
                      <button onClick={() => setEditingModulesId(null)} className="px-3 py-1.5 border rounded text-xs text-gray-600 hover:bg-gray-50">Cancel</button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex flex-wrap gap-1">
                      {parseModules(u.allowedModules).length > 0 ? (
                        parseModules(u.allowedModules).map(key => {
                          const mod = ALL_MODULES.find(m => m.key === key);
                          return <span key={key} className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs">{mod?.label || key}</span>;
                        })
                      ) : (
                        <span className="text-xs text-amber-600">No modules assigned</span>
                      )}
                    </div>
                    <button onClick={() => startEditModules(u)} className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                      <Shield size={12} /> Edit Access
                    </button>
                  </div>
                )}
              </div>
            )}
            {u.role === 'ADMIN' && (
              <div className="mt-2 text-xs text-gray-400">Admin — full access to all modules</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
